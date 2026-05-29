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

use bun_event_loop::{Task, TaskTag, Taskable, task_tag};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue};

use crate::api::html_rewriter;
use crate::api::server;
use crate::webcore::body;

type HTTPServerRequestContext = server::NewRequestContext<server::HTTPServer, false, false, false>;
type HTTPSServerRequestContext = server::NewRequestContext<server::HTTPSServer, true, false, false>;
type DebugHTTPServerRequestContext =
    server::NewRequestContext<server::DebugHTTPServer, false, true, false>;
type DebugHTTPSServerRequestContext =
    server::NewRequestContext<server::DebugHTTPSServer, true, true, false>;
type HTTPSServerH3RequestContext =
    server::NewRequestContext<server::HTTPSServer, true, false, true>;
type DebugHTTPSServerH3RequestContext =
    server::NewRequestContext<server::DebugHTTPSServer, true, true, true>;

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
        match n {
            0 => Tag::HTTPServerRequestContext,
            1 => Tag::HTTPSServerRequestContext,
            2 => Tag::DebugHTTPServerRequestContext,
            3 => Tag::DebugHTTPSServerRequestContext,
            4 => Tag::BodyValueBufferer,
            5 => Tag::HTTPSServerH3RequestContext,
            6 => Tag::DebugHTTPSServerH3RequestContext,
            _ => unreachable!(),
        }
    }
}

/// Maps a concrete native type to its `Tag`. This replaces Zig's
/// `Tag.fromType(comptime T: type)` which switched on `@TypeOf` — Rust
/// expresses the same compile-time mapping as a trait impl per type.
pub(crate) trait NativePromiseContextType {
    const TAG: Tag;
}

const fn npc_tag_for(ssl: bool, dbg: bool, h3: bool) -> Tag {
    match (ssl, dbg, h3) {
        (false, false, false) => Tag::HTTPServerRequestContext,
        (true, false, false) => Tag::HTTPSServerRequestContext,
        (false, true, false) => Tag::DebugHTTPServerRequestContext,
        (true, true, false) => Tag::DebugHTTPSServerRequestContext,
        (true, false, true) => Tag::HTTPSServerH3RequestContext,
        (true, true, true) => Tag::DebugHTTPSServerH3RequestContext,
        // H3 requires TLS; (false, _, true) is never instantiated. Map to a
        // valid tag so const-eval succeeds; runtime never observes this.
        (false, _, true) => Tag::HTTPServerRequestContext,
    }
}
impl<ThisServer, const SSL: bool, const DBG: bool, const H3: bool> NativePromiseContextType
    for server::NewRequestContext<ThisServer, SSL, DBG, H3>
{
    const TAG: Tag = npc_tag_for(SSL, DBG, H3);
}
impl NativePromiseContextType for body::ValueBufferer<'_> {
    const TAG: Tag = Tag::BodyValueBufferer;
}

unsafe extern "C" {
    safe fn Bun__NativePromiseContext__create(
        global: &JSGlobalObject,
        ctx: *mut c_void,
        tag: u8,
    ) -> JSValue;
    safe fn Bun__NativePromiseContext__take(value: JSValue) -> *mut c_void;
}

/// The caller must have already taken a ref on `ctx`. The returned cell owns
/// that ref until `take()` transfers it back or GC runs the destructor.
pub(crate) fn create<T: NativePromiseContextType>(global: &JSGlobalObject, ctx: *mut T) -> JSValue {
    Bun__NativePromiseContext__create(global, ctx.cast::<c_void>(), T::TAG as u8)
}

/// Transfers the ref back to the caller and nulls the cell so the destructor
/// is a no-op. Returns null if already taken (e.g., the connection aborted
/// and the ref was released via the destructor on a prior GC cycle).
pub(crate) fn take<T>(cell: JSValue) -> Option<NonNull<T>> {
    NonNull::new(Bun__NativePromiseContext__take(cell).cast::<T>())
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__NativePromiseContext__destroy(ctx: *mut c_void, tag: u8) {
    DeferredDerefTask::schedule(ctx, Tag::from_raw(tag));
}

pub(crate) struct DeferredDerefTask;

impl Taskable for DeferredDerefTask {
    const TAG: TaskTag = task_tag::NativePromiseContextDeferredDerefTask;
}

impl DeferredDerefTask {
    const TAG_MASK: usize = 0b111;

    pub(crate) fn schedule(ctx: *mut c_void, tag: Tag) {
        // SAFETY: called from the JS thread (GC sweep → C++ destructor); the
        // thread-local VM is alive for the duration of this call.
        let vm = VirtualMachine::get();
        // Process is dying; the leak no longer matters and the task
        // queue won't drain.
        if vm.is_shutting_down() {
            return;
        }

        let addr = ctx as usize;
        debug_assert!(addr & Self::TAG_MASK == 0);

        let task = Task::new(
            <DeferredDerefTask as Taskable>::TAG,
            (addr | (tag as usize)) as *mut (),
        );
        // SAFETY: event_loop() returns the VM's owned EventLoop; we are the
        // sole mutator on the JS thread here.
        vm.event_loop_ref().enqueue_task(task);
    }

    pub(crate) fn run_from_js_thread(packed_ptr: usize) {
        let tag = Tag::from_raw((packed_ptr & Self::TAG_MASK) as u8);
        let ctx = (packed_ptr & !Self::TAG_MASK) as *mut c_void;
        // SAFETY: ctx was packed in `schedule` from a live intrusive-refcounted
        // pointer of the type indicated by `tag`; we are on the JS thread.
        unsafe {
            match tag {
                Tag::HTTPServerRequestContext => (*ctx.cast::<HTTPServerRequestContext>()).deref(),
                Tag::HTTPSServerRequestContext => {
                    (*ctx.cast::<HTTPSServerRequestContext>()).deref()
                }
                Tag::DebugHTTPServerRequestContext => {
                    (*ctx.cast::<DebugHTTPServerRequestContext>()).deref()
                }
                Tag::DebugHTTPSServerRequestContext => {
                    (*ctx.cast::<DebugHTTPSServerRequestContext>()).deref()
                }
                Tag::BodyValueBufferer => {
                    let bufferer = &*ctx.cast::<body::ValueBufferer<'_>>();
                    html_rewriter::BufferOutputSink::deref(
                        bufferer.ctx.cast::<html_rewriter::BufferOutputSink>(),
                    );
                }
                Tag::HTTPSServerH3RequestContext => {
                    (*ctx.cast::<HTTPSServerH3RequestContext>()).deref()
                }
                Tag::DebugHTTPSServerH3RequestContext => {
                    (*ctx.cast::<DebugHTTPSServerH3RequestContext>()).deref()
                }
            }
        }
    }
}

// Low 3 bits hold the tag; verify both capacity and alignment slack so adding
// a tag or a packed field can't silently break the packing.
const _: () = assert!(Tag::COUNT <= DeferredDerefTask::TAG_MASK + 1);
const _: () =
    assert!(core::mem::align_of::<HTTPServerRequestContext>() > DeferredDerefTask::TAG_MASK);
const _: () =
    assert!(core::mem::align_of::<HTTPSServerRequestContext>() > DeferredDerefTask::TAG_MASK);
const _: () =
    assert!(core::mem::align_of::<DebugHTTPServerRequestContext>() > DeferredDerefTask::TAG_MASK);
const _: () =
    assert!(core::mem::align_of::<DebugHTTPSServerRequestContext>() > DeferredDerefTask::TAG_MASK);
const _: () =
    assert!(core::mem::align_of::<body::ValueBufferer<'_>>() > DeferredDerefTask::TAG_MASK);

// ported from: src/runtime/api/NativePromiseContext.zig
