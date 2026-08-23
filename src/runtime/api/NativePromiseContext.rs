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
//! ```ignore
//! let cell = bun_jsc::native_promise_context::create(global, RefPtr::from_this(ctx), JSValue::ZERO);
//! promise.then_with_value(global, cell, on_resolve, on_reject)?;
//!
//! // In on_resolve/on_reject:
//! let Some(ctx) = bun_jsc::native_promise_context::take::<RequestContext>(arguments[1]) else { return; };
//! // ... process; the ref is released when `ctx` drops.
//! ```

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_event_loop::{Task, TaskTag, Taskable, task_tag};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue};

use crate::api::html_rewriter;
use crate::api::server;

// Request contexts are a single generic
// `NewRequestContext<ThisServer, SSL, DEBUG, MUX>`; alias the eight
// concrete monomorphizations here so the tag↔type mapping stays readable.
type HTTPServerRequestContext = server::NewRequestContext<server::HTTPServer, false, false, false>;
type HTTPSServerRequestContext = server::NewRequestContext<server::HTTPSServer, true, false, false>;
type DebugHTTPServerRequestContext =
    server::NewRequestContext<server::DebugHTTPServer, false, true, false>;
type DebugHTTPSServerRequestContext =
    server::NewRequestContext<server::DebugHTTPSServer, true, true, false>;
type HTTPServerMuxRequestContext =
    server::NewRequestContext<server::HTTPServer, false, false, true>;
type HTTPSServerMuxRequestContext =
    server::NewRequestContext<server::HTTPSServer, true, false, true>;
type DebugHTTPServerMuxRequestContext =
    server::NewRequestContext<server::DebugHTTPServer, false, true, true>;
type DebugHTTPSServerMuxRequestContext =
    server::NewRequestContext<server::DebugHTTPSServer, true, true, true>;

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
    HTTPServerMuxRequestContext,
    HTTPSServerMuxRequestContext,
    DebugHTTPServerMuxRequestContext,
    DebugHTTPSServerMuxRequestContext,
    HTMLRewriterSuspension,
    /// Task-only tag (never a context cell): drops the last ref of a
    /// `RewriterPipe` on behalf of `RewriterPipe::deref_outside_caller`.
    HTMLRewriterPipeFree,
}

impl Tag {
    pub const COUNT: usize = 10;

    #[inline]
    const fn from_raw(n: u8) -> Tag {
        match n {
            0 => Tag::HTTPServerRequestContext,
            1 => Tag::HTTPSServerRequestContext,
            2 => Tag::DebugHTTPServerRequestContext,
            3 => Tag::DebugHTTPSServerRequestContext,
            4 => Tag::HTTPServerMuxRequestContext,
            5 => Tag::HTTPSServerMuxRequestContext,
            6 => Tag::DebugHTTPServerMuxRequestContext,
            7 => Tag::DebugHTTPSServerMuxRequestContext,
            8 => Tag::HTMLRewriterSuspension,
            9 => Tag::HTMLRewriterPipeFree,
            _ => unreachable!(),
        }
    }
}

// The tag depends only on (SSL, DBG, MUX): `ServerLike` is sealed to
// `NewServer<SSL, DBG>` and a context whose server's `(SSL, DEBUG)` differ from
// its own gets no tag, so each tag names exactly one type.
const fn npc_tag_for(server_ssl: bool, server_dbg: bool, ssl: bool, dbg: bool, mux: bool) -> u8 {
    if server_ssl != ssl || server_dbg != dbg {
        return bun_jsc::native_promise_context::INVALID_TAG;
    }
    (match (ssl, dbg, mux) {
        (false, false, false) => Tag::HTTPServerRequestContext,
        (true, false, false) => Tag::HTTPSServerRequestContext,
        (false, true, false) => Tag::DebugHTTPServerRequestContext,
        (true, true, false) => Tag::DebugHTTPSServerRequestContext,
        (false, false, true) => Tag::HTTPServerMuxRequestContext,
        (true, false, true) => Tag::HTTPSServerMuxRequestContext,
        (false, true, true) => Tag::DebugHTTPServerMuxRequestContext,
        (true, true, true) => Tag::DebugHTTPSServerMuxRequestContext,
    }) as u8
}
bun_jsc::native_promise_context_type!(
    impl [ThisServer: server::ServerLike + 'static, const SSL: bool, const DBG: bool, const MUX: bool]
    for server::NewRequestContext<ThisServer, SSL, DBG, MUX> =>
        npc_tag_for(ThisServer::SSL, ThisServer::DEBUG, SSL, DBG, MUX)
);

// `&JSGlobalObject` is ABI-identical to a non-null pointer. `ctx` is stored
// opaquely (never dereferenced by the C++ side), so the FFI itself has no
// pointer-validity precondition — the ref-count contract is documented on
// `create_html_rewriter_suspension()` below, not on the FFI call.
unsafe extern "C" {
    safe fn Bun__NativePromiseContext__create(
        global: &JSGlobalObject,
        ctx: *mut c_void,
        tag: u8,
        held: JSValue,
    ) -> JSValue;
    safe fn Bun__NativePromiseContext__take(value: JSValue, tag: u8) -> *mut c_void;
}

/// A `Tag::HTMLRewriterSuspension` cell. The cell owns the caller's claim on
/// `pipe` until `take_html_rewriter_suspension()` transfers it back or GC runs
/// the destructor (which defers to [`DeferredDerefTask`]). `held` is visited
/// by the cell, so whatever GC object keeps `pipe` alive can ride along for as
/// long as the promise can settle. (Request contexts use the typed
/// [`bun_jsc::native_promise_context::create`], whose cell owns a `RefPtr`.)
pub(crate) fn create_html_rewriter_suspension(
    global: &JSGlobalObject,
    pipe: NonNull<html_rewriter::RewriterPipe>,
    held: JSValue,
) -> JSValue {
    Bun__NativePromiseContext__create(
        global,
        pipe.as_ptr().cast::<c_void>(),
        Tag::HTMLRewriterSuspension as u8,
        held,
    )
}

/// Transfers the claim back to the caller and nulls the cell so the destructor
/// is a no-op. Returns null if already taken (the suspension was abandoned) or
/// if `cell` is not an HTMLRewriter suspension cell.
pub(crate) fn take_html_rewriter_suspension(
    cell: JSValue,
) -> Option<NonNull<html_rewriter::RewriterPipe>> {
    if cell.is_empty() {
        return None;
    }
    NonNull::new(
        Bun__NativePromiseContext__take(cell, Tag::HTMLRewriterSuspension as u8)
            .cast::<html_rewriter::RewriterPipe>(),
    )
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
extern "C" fn Bun__NativePromiseContext__destroy(ctx: *mut c_void, tag: u8) {
    let tag = Tag::from_raw(tag);
    clear_remembered_cell(ctx, tag);
    DeferredDerefTask::schedule(ctx, tag);
}

/// The cell dies with its claim intact, so the context's `promise_cell` field
/// still points at it and is about to dangle. Clear it before `on_abort` can
/// read it again. A plain field write, safe during sweep; the unreleased
/// claim keeps `ctx` alive through this call.
fn clear_remembered_cell(ctx: *mut c_void, tag: Tag) {
    // SAFETY: `tag` names the concrete type `ctx` was created with, and the
    // claim being released is a live ref on it.
    unsafe {
        match tag {
            Tag::HTTPServerRequestContext => {
                (*ctx.cast::<HTTPServerRequestContext>()).promise_cell_collected()
            }
            Tag::HTTPSServerRequestContext => {
                (*ctx.cast::<HTTPSServerRequestContext>()).promise_cell_collected()
            }
            Tag::DebugHTTPServerRequestContext => {
                (*ctx.cast::<DebugHTTPServerRequestContext>()).promise_cell_collected()
            }
            Tag::DebugHTTPSServerRequestContext => {
                (*ctx.cast::<DebugHTTPSServerRequestContext>()).promise_cell_collected()
            }
            Tag::HTTPServerMuxRequestContext => {
                (*ctx.cast::<HTTPServerMuxRequestContext>()).promise_cell_collected()
            }
            Tag::HTTPSServerMuxRequestContext => {
                (*ctx.cast::<HTTPSServerMuxRequestContext>()).promise_cell_collected()
            }
            Tag::DebugHTTPServerMuxRequestContext => {
                (*ctx.cast::<DebugHTTPServerMuxRequestContext>()).promise_cell_collected()
            }
            Tag::DebugHTTPSServerMuxRequestContext => {
                (*ctx.cast::<DebugHTTPSServerMuxRequestContext>()).promise_cell_collected()
            }
            Tag::HTMLRewriterSuspension | Tag::HTMLRewriterPipeFree => {}
        }
    }
}

/// Defers the GC-triggered deref to the next event-loop tick so it runs
/// outside the sweep phase.
///
/// Zero-allocation: the ctx pointer and our Tag are packed into the task's
/// `ptr` slot (pointer in high bits, tag in low 4 bits — the target types
/// are all 16-byte aligned, see their `#[repr(align(16))]`). See PosixSignalTask for the same trick with
/// signal numbers.
///
/// Layout of `Task.ptr` (read back as `usize` in dispatch):
///
/// ```text
/// bits 63..4           bits 3..0
/// ┌────────────────────┬─────────┐
/// │ ctx ptr (aligned)  │ our Tag │
/// └────────────────────┴─────────┘
/// ```
///
/// `Task` stores `{ tag, ptr }` as separate fields, so the discriminant is
/// carried in `Task.tag` and only the ctx|Tag packing remains in `Task.ptr`.
pub(crate) struct DeferredDerefTask;

impl Taskable for DeferredDerefTask {
    const TAG: TaskTag = task_tag::NativePromiseContextDeferredDerefTask;
    /// `this` packs a context pointer and tag; the deref it defers is
    /// script-free, so do it.
    unsafe fn release_unrun(this: *mut Self) {
        Self::run_from_js_thread(this as usize);
    }
}

impl DeferredDerefTask {
    const TAG_MASK: usize = 0b1111;

    pub(crate) fn schedule(ctx: *mut c_void, tag: Tag) {
        // SAFETY: called from the JS thread (GC sweep → C++ destructor); the
        // thread-local VM is alive for the duration of this call.
        let vm = VirtualMachine::get();
        if vm.event_loop_ref().is_closed_for_tasks() {
            // Teardown has forbidden script and released the queue; from here on only GC destructors
            // (possibly mid-sweep in `~VM`) reach this, and theirs is the last use of `ctx` in that
            // frame. A worker's HTMLRewriter pipe would outlive it, so those refs are released now,
            // sweep-safe; a RequestContext's deref is not sweep-safe and dies with the VM instead.
            match tag {
                // SAFETY: the destroyed context held the suspension's ref on this live pipe.
                Tag::HTMLRewriterSuspension => unsafe {
                    html_rewriter::RewriterPipe::abandon_suspension(bun_ptr::BackRef::from(
                        NonNull::new_unchecked(ctx.cast::<html_rewriter::RewriterPipe>()),
                    ))
                },
                // SAFETY: the detached controller handed over the pipe's last ref (its destructor's
                // trailing `finalize` is a no-op for this sink).
                Tag::HTMLRewriterPipeFree => unsafe {
                    <html_rewriter::RewriterPipe as bun_ptr::CellRefCounted>::deref_nn(
                        NonNull::new_unchecked(ctx.cast::<html_rewriter::RewriterPipe>()),
                    )
                },
                _ => {}
            }
            return;
        }

        let addr = ctx as usize;
        debug_assert!(addr & Self::TAG_MASK == 0);

        // `Task` is a plain `{ tag, ptr }` pair (no bitfield packing), so
        // build it directly — dispatch unpacks via `task.ptr as usize`.
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
        use bun_jsc::native_promise_context::destroyed_ref;
        // SAFETY: ctx was packed in `schedule` from a live, non-null pointer
        // of the type indicated by `tag`, and this task owns one ref on it,
        // released below (for the request contexts: the `RefPtr` the cell was
        // created with; for the HTMLRewriter tags: the ref taken in
        // `begin_suspension`, or the last ref handed over by
        // `deref_outside_caller`). We are on the JS thread.
        unsafe {
            match tag {
                Tag::HTTPServerRequestContext => {
                    drop(destroyed_ref::<HTTPServerRequestContext>(ctx))
                }
                Tag::HTTPSServerRequestContext => {
                    drop(destroyed_ref::<HTTPSServerRequestContext>(ctx))
                }
                Tag::DebugHTTPServerRequestContext => {
                    drop(destroyed_ref::<DebugHTTPServerRequestContext>(ctx))
                }
                Tag::DebugHTTPSServerRequestContext => {
                    drop(destroyed_ref::<DebugHTTPSServerRequestContext>(ctx))
                }
                Tag::HTTPServerMuxRequestContext => {
                    drop(destroyed_ref::<HTTPServerMuxRequestContext>(ctx))
                }
                Tag::HTTPSServerMuxRequestContext => {
                    drop(destroyed_ref::<HTTPSServerMuxRequestContext>(ctx))
                }
                Tag::DebugHTTPServerMuxRequestContext => {
                    drop(destroyed_ref::<DebugHTTPServerMuxRequestContext>(ctx))
                }
                Tag::DebugHTTPSServerMuxRequestContext => {
                    drop(destroyed_ref::<DebugHTTPSServerMuxRequestContext>(ctx))
                }
                Tag::HTMLRewriterSuspension => {
                    let back = bun_ptr::BackRef::from(NonNull::new_unchecked(
                        ctx.cast::<html_rewriter::RewriterPipe>(),
                    ));
                    html_rewriter::RewriterPipe::abandon_suspension(back);
                }
                Tag::HTMLRewriterPipeFree => {
                    <html_rewriter::RewriterPipe as bun_ptr::CellRefCounted>::deref_nn(
                        NonNull::new_unchecked(ctx.cast::<html_rewriter::RewriterPipe>()),
                    );
                }
            }
        }
    }
}

// Low 4 bits hold the tag; verify both capacity and alignment slack so adding
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
    assert!(core::mem::align_of::<HTTPServerMuxRequestContext>() > DeferredDerefTask::TAG_MASK);
const _: () = assert!(
    core::mem::align_of::<DebugHTTPSServerMuxRequestContext>() > DeferredDerefTask::TAG_MASK
);
const _: () =
    assert!(core::mem::align_of::<HTTPSServerMuxRequestContext>() > DeferredDerefTask::TAG_MASK);
const _: () = assert!(
    core::mem::align_of::<DebugHTTPServerMuxRequestContext>() > DeferredDerefTask::TAG_MASK
);
const _: () =
    assert!(core::mem::align_of::<html_rewriter::RewriterPipe>() > DeferredDerefTask::TAG_MASK);
