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

// Request contexts are a single generic
// `NewRequestContext<ThisServer, SSL, DEBUG, MUX>`; alias the eight
// concrete monomorphizations here so the tag↔type mapping stays readable.
type HTTPServerRequestContext =
    server::NewRequestContext<server::HTTPServer, false, false, { server::MUX_H1 }>;
type HTTPSServerRequestContext =
    server::NewRequestContext<server::HTTPSServer, true, false, { server::MUX_H1 }>;
type DebugHTTPServerRequestContext =
    server::NewRequestContext<server::DebugHTTPServer, false, true, { server::MUX_H1 }>;
type DebugHTTPSServerRequestContext =
    server::NewRequestContext<server::DebugHTTPSServer, true, true, { server::MUX_H1 }>;
type HTTPSServerH3RequestContext =
    server::NewRequestContext<server::HTTPSServer, true, false, { server::MUX_H3 }>;
type DebugHTTPSServerH3RequestContext =
    server::NewRequestContext<server::DebugHTTPSServer, true, true, { server::MUX_H3 }>;
type HTTPSServerH2RequestContext =
    server::NewRequestContext<server::HTTPSServer, true, false, { server::MUX_H2 }>;
type DebugHTTPSServerH2RequestContext =
    server::NewRequestContext<server::DebugHTTPSServer, true, true, { server::MUX_H2 }>;

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
    HTTPSServerH2RequestContext,
    DebugHTTPSServerH2RequestContext,
}

impl Tag {
    pub const COUNT: usize = 9;

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
            7 => Tag::HTTPSServerH2RequestContext,
            8 => Tag::DebugHTTPSServerH2RequestContext,
            _ => unreachable!(),
        }
    }
}

/// Maps a concrete native type to its `Tag`, expressed as a compile-time
/// mapping via a trait impl per type.
pub(crate) trait NativePromiseContextType {
    const TAG: Tag;
}

// Layering note: blanket-impl over `ThisServer` so that ANY server
// type (mod.rs::NewServer or server_body::NewServer) yields the same Tag —
// the tag depends only on (SSL, DBG, MUX), never on the server type.
const fn npc_tag_for(ssl: bool, dbg: bool, mux: u8) -> Tag {
    match (ssl, dbg, mux) {
        (false, false, server::MUX_H1) => Tag::HTTPServerRequestContext,
        (true, false, server::MUX_H1) => Tag::HTTPSServerRequestContext,
        (false, true, server::MUX_H1) => Tag::DebugHTTPServerRequestContext,
        (true, true, server::MUX_H1) => Tag::DebugHTTPSServerRequestContext,
        (true, false, server::MUX_H3) => Tag::HTTPSServerH3RequestContext,
        (true, true, server::MUX_H3) => Tag::DebugHTTPSServerH3RequestContext,
        (true, false, server::MUX_H2) => Tag::HTTPSServerH2RequestContext,
        (true, true, server::MUX_H2) => Tag::DebugHTTPSServerH2RequestContext,
        // H2/H3 require TLS; (false, _, MUX_H2|MUX_H3) is never instantiated.
        // Map to a valid tag so const-eval succeeds; runtime never observes this.
        _ => Tag::HTTPServerRequestContext,
    }
}
impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: u8> NativePromiseContextType
    for server::NewRequestContext<ThisServer, SSL, DBG, MUX>
{
    const TAG: Tag = npc_tag_for(SSL, DBG, MUX);
}
impl NativePromiseContextType for body::ValueBufferer<'_> {
    const TAG: Tag = Tag::BodyValueBufferer;
}

// `&JSGlobalObject` is ABI-identical to a non-null pointer. `ctx` is stored
// opaquely (never dereferenced by the C++ side), so the FFI itself has no
// pointer-validity precondition — the ref-count contract is documented on
// `create()` below, not on the FFI call.
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
pub(crate) extern "C" fn Bun__NativePromiseContext__destroy(ctx: *mut c_void, tag: u8) {
    DeferredDerefTask::schedule(ctx, Tag::from_raw(tag));
}

/// Defers the GC-triggered deref to the next event-loop tick so it runs
/// outside the sweep phase.
///
/// Zero-allocation: the ctx pointer and our Tag are packed into the task's
/// `ptr` slot (pointer in the low 56 bits, tag in the top byte — user-space
/// pointers on every Bun target leave the top byte zero; same trick
/// `WTF::CompactPointerTuple` uses on the C++ side). See PosixSignalTask for
/// the low-bit variant of this idiom.
///
/// Layout of `Task.ptr` (read back as `usize` in dispatch):
///
///     bits 63..56   bits 55..0
///     ┌──────────┬────────────────────┐
///     │ our Tag  │ ctx ptr            │
///     └──────────┴────────────────────┘
///
/// `Task` stores `{ tag, ptr }` as separate fields, so the discriminant is
/// carried in `Task.tag` and only the ctx|Tag packing remains in `Task.ptr`.
pub(crate) struct DeferredDerefTask;

impl Taskable for DeferredDerefTask {
    const TAG: TaskTag = task_tag::NativePromiseContextDeferredDerefTask;
}

impl DeferredDerefTask {
    const TAG_SHIFT: usize = 56;
    const TAG_MASK: usize = 0xFF << Self::TAG_SHIFT;

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

        // `Task` is a plain `{ tag, ptr }` pair (no bitfield packing), so
        // build it directly — dispatch unpacks via `task.ptr as usize`.
        let task = Task::new(
            <DeferredDerefTask as Taskable>::TAG,
            (addr | ((tag as usize) << Self::TAG_SHIFT)) as *mut (),
        );
        // SAFETY: event_loop() returns the VM's owned EventLoop; we are the
        // sole mutator on the JS thread here.
        vm.event_loop_ref().enqueue_task(task);
    }

    pub(crate) fn run_from_js_thread(packed_ptr: usize) {
        let tag = Tag::from_raw((packed_ptr >> Self::TAG_SHIFT) as u8);
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
                    // ValueBufferer is embedded by value inside HTMLRewriter's
                    // BufferOutputSink, with the owner pointer stored in .ctx.
                    // The pending-promise ref was taken on the owner, so we
                    // release it there.
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
                Tag::HTTPSServerH2RequestContext => {
                    (*ctx.cast::<HTTPSServerH2RequestContext>()).deref()
                }
                Tag::DebugHTTPSServerH2RequestContext => {
                    (*ctx.cast::<DebugHTTPSServerH2RequestContext>()).deref()
                }
            }
        }
    }
}

// Top byte holds the tag; verify capacity so adding a tag can't silently
// overflow the packing. No alignment constraint — the top byte of a
// user-space pointer is zero on every Bun target.
const _: () = assert!(Tag::COUNT <= (1usize << (64 - DeferredDerefTask::TAG_SHIFT)));
const _: () = assert!(core::mem::size_of::<usize>() == 8);
