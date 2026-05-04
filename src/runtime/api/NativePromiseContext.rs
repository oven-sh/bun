//! Rust bindings for the NativePromiseContext JSCell.
//!
//! See src/jsc/bindings/NativePromiseContext.h for the rationale. Short
//! version: when native code `.then()`s a user Promise and needs a context
//! pointer, wrap the pointer in this GC-managed cell instead of passing it
//! raw. If the Promise never settles, GC collects the cell and the destructor
//! releases the ref — no leak, no use-after-free.
//!
//! Usage pattern:
//!
//!     ctx.ref_();
//!     let cell = native_promise_context::create(global, ctx);
//!     promise.then_with_value(global, cell, on_resolve, on_reject)?;
//!
//!     // In on_resolve/on_reject:
//!     let Some(ctx) = native_promise_context::take::<RequestContext>(arguments[1]) else { return; };
//!     // ... process ...
//!     ctx.deref_();

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, Task, VirtualMachine};

use crate::api::html_rewriter::HTMLRewriter;
use crate::api::server;
use crate::webcore::body;

/// Must match Bun::NativePromiseContext::Tag in NativePromiseContext.h.
/// One entry per concrete native type — the tag is packed into the pointer's
/// upper bits via CompactPointerTuple so the cell stays at one pointer of
/// storage beyond the JSCell header.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Tag {
    HTTPServerRequestContext,
    HTTPSServerRequestContext,
    DebugHTTPServerRequestContext,
    DebugHTTPSServerRequestContext,
    BodyValueBufferer,
    HTTPSServerH3RequestContext,
    DebugHTTPSServerH3RequestContext,
}

impl Tag {
    pub const COUNT: usize = 7;

    #[inline]
    const fn from_raw(n: u8) -> Tag {
        debug_assert!((n as usize) < Self::COUNT);
        // SAFETY: #[repr(u8)] and n is range-checked above in debug.
        unsafe { core::mem::transmute::<u8, Tag>(n) }
    }
}

/// Maps a concrete native type to its `Tag`. This replaces Zig's
/// `Tag.fromType(comptime T: type)` which switched on `@TypeOf` — Rust
/// expresses the same compile-time mapping as a trait impl per type.
pub trait NativePromiseContextType {
    const TAG: Tag;
}

// TODO(port): exact Rust paths for these server RequestContext monomorphizations
// depend on how `server.zig`'s generic `NewServer(...)` is ported. Adjust the
// impl targets in Phase B once `crate::api::server` lands.
impl NativePromiseContextType for server::HTTPServer::RequestContext {
    const TAG: Tag = Tag::HTTPServerRequestContext;
}
impl NativePromiseContextType for server::HTTPSServer::RequestContext {
    const TAG: Tag = Tag::HTTPSServerRequestContext;
}
impl NativePromiseContextType for server::DebugHTTPServer::RequestContext {
    const TAG: Tag = Tag::DebugHTTPServerRequestContext;
}
impl NativePromiseContextType for server::DebugHTTPSServer::RequestContext {
    const TAG: Tag = Tag::DebugHTTPSServerRequestContext;
}
impl NativePromiseContextType for server::HTTPSServer::H3RequestContext {
    const TAG: Tag = Tag::HTTPSServerH3RequestContext;
}
impl NativePromiseContextType for server::DebugHTTPSServer::H3RequestContext {
    const TAG: Tag = Tag::DebugHTTPSServerH3RequestContext;
}
impl NativePromiseContextType for body::ValueBufferer {
    const TAG: Tag = Tag::BodyValueBufferer;
}

// TODO(port): move to <runtime>_sys
unsafe extern "C" {
    fn Bun__NativePromiseContext__create(
        global: *const JSGlobalObject,
        ctx: *mut c_void,
        tag: u8,
    ) -> JSValue;
    fn Bun__NativePromiseContext__take(value: JSValue) -> *mut c_void;
}

/// The caller must have already taken a ref on `ctx`. The returned cell owns
/// that ref until `take()` transfers it back or GC runs the destructor.
pub fn create<T: NativePromiseContextType>(global: &JSGlobalObject, ctx: *mut T) -> JSValue {
    // SAFETY: ctx is a valid intrusive-refcounted pointer the caller just ref'd.
    unsafe { Bun__NativePromiseContext__create(global, ctx.cast::<c_void>(), T::TAG as u8) }
}

/// Transfers the ref back to the caller and nulls the cell so the destructor
/// is a no-op. Returns null if already taken (e.g., the connection aborted
/// and the ref was released via the destructor on a prior GC cycle).
pub fn take<T>(cell: JSValue) -> Option<NonNull<T>> {
    // SAFETY: cell was produced by `create` above; FFI returns the original ctx or null.
    NonNull::new(unsafe { Bun__NativePromiseContext__take(cell) }.cast::<T>())
}

/// Called from the C++ destructor when a cell is collected with a non-null
/// pointer (i.e., `take()` was never called — the Promise was GC'd without
/// settling).
///
/// The destructor runs during GC sweep, so it is NOT safe to do anything
/// that might touch the JSC heap. RequestContext.deref() can trigger
/// deinit() which detaches responses, unrefs bodies, and calls back into
/// the server — all of which may unprotect JS values or allocate. We must
/// defer that work to the event loop.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__NativePromiseContext__destroy(ctx: *mut c_void, tag: u8) {
    DeferredDerefTask::schedule(ctx, Tag::from_raw(tag));
}

/// Defers the GC-triggered deref to the next event-loop tick so it runs
/// outside the sweep phase.
///
/// Zero-allocation: the ctx pointer and our Tag are packed into the task's
/// `_ptr` slot (pointer in high bits, tag in low 3 bits — the target types
/// are all >= 8-byte aligned). See PosixSignalTask for the same trick with
/// signal numbers.
///
/// Layout inside jsc.Task's packed u64 after set_uintptr:
///
///     bits 63..49  bits 48..3           bits 2..0
///     ┌──────────┬────────────────────┬─────────┐
///     │ data=u15 │ ctx ptr (aligned)  │ our Tag │
///     └──────────┴────────────────────┴─────────┘
///          ▲              ▲                 ▲
///          │              └─────────┬───────┘
///      Task union           _ptr (u49) — set by set_uintptr
///      discriminant
///      (set by init,
///       untouched)
///
/// set_uintptr only writes _ptr; the Task discriminant in data that
/// Task::init(&marker) stamped stays put. Truncating to u49 keeps the low
/// bits, so both the ctx pointer (bits 3..48) and our Tag (bits 0..2)
/// survive.
pub struct DeferredDerefTask;

impl DeferredDerefTask {
    const TAG_MASK: usize = 0b111;

    pub fn schedule(ctx: *mut c_void, tag: Tag) {
        let vm = VirtualMachine::get();
        // Process is dying; the leak no longer matters and the task
        // queue won't drain.
        if vm.is_shutting_down() {
            return;
        }

        let addr = ctx as usize;
        debug_assert!(addr & Self::TAG_MASK == 0);

        let marker = DeferredDerefTask;
        let mut task = Task::init(&marker);
        // Zig: @truncate(addr | @intFromEnum(tag)) → set_uintptr stores into the
        // 49-bit _ptr field; truncation to u49 happens inside set_uintptr.
        task.set_uintptr(addr | (tag as usize));
        vm.event_loop().enqueue_task(task);
    }

    pub fn run_from_js_thread(packed_ptr: usize) {
        let tag = Tag::from_raw((packed_ptr & Self::TAG_MASK) as u8);
        let ctx = (packed_ptr & !Self::TAG_MASK) as *mut c_void;
        // SAFETY: ctx was packed in `schedule` from a live intrusive-refcounted
        // pointer of the type indicated by `tag`; we are on the JS thread.
        unsafe {
            match tag {
                Tag::HTTPServerRequestContext => {
                    (*ctx.cast::<server::HTTPServer::RequestContext>()).deref_()
                }
                Tag::HTTPSServerRequestContext => {
                    (*ctx.cast::<server::HTTPSServer::RequestContext>()).deref_()
                }
                Tag::DebugHTTPServerRequestContext => {
                    (*ctx.cast::<server::DebugHTTPServer::RequestContext>()).deref_()
                }
                Tag::DebugHTTPSServerRequestContext => {
                    (*ctx.cast::<server::DebugHTTPSServer::RequestContext>()).deref_()
                }
                Tag::BodyValueBufferer => {
                    // ValueBufferer is embedded by value inside HTMLRewriter's
                    // BufferOutputSink, with the owner pointer stored in .ctx.
                    // The pending-promise ref was taken on the owner, so we
                    // release it there.
                    let bufferer = &*ctx.cast::<body::ValueBufferer>();
                    (*bufferer.ctx.cast::<HTMLRewriter::BufferOutputSink>()).deref_();
                }
                Tag::HTTPSServerH3RequestContext => {
                    (*ctx.cast::<server::HTTPSServer::H3RequestContext>()).deref_()
                }
                Tag::DebugHTTPSServerH3RequestContext => {
                    (*ctx.cast::<server::DebugHTTPSServer::H3RequestContext>()).deref_()
                }
            }
        }
    }
}

// Low 3 bits hold the tag; verify both capacity and alignment slack so adding
// a tag or a packed field can't silently break the packing.
const _: () = assert!(Tag::COUNT <= DeferredDerefTask::TAG_MASK + 1);
// TODO(port): re-enable these once the concrete server RequestContext types are
// addressable from Rust (Zig used @alignOf at comptime).
// const _: () = assert!(core::mem::align_of::<server::HTTPServer::RequestContext>() > DeferredDerefTask::TAG_MASK);
// const _: () = assert!(core::mem::align_of::<server::HTTPSServer::RequestContext>() > DeferredDerefTask::TAG_MASK);
// const _: () = assert!(core::mem::align_of::<server::DebugHTTPServer::RequestContext>() > DeferredDerefTask::TAG_MASK);
// const _: () = assert!(core::mem::align_of::<server::DebugHTTPSServer::RequestContext>() > DeferredDerefTask::TAG_MASK);
// const _: () = assert!(core::mem::align_of::<body::ValueBufferer>() > DeferredDerefTask::TAG_MASK);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/NativePromiseContext.zig (163 lines)
//   confidence: medium
//   todos:      3
//   notes:      Tag.fromType comptime-switch ported as trait; server::*::RequestContext paths are placeholders pending server.zig port; Task::init/set_uintptr signatures assumed.
// ──────────────────────────────────────────────────────────────────────────
