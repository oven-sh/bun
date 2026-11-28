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
//! let cell = native_promise_context::create(global, ctx.clone(), JSValue::ZERO);
//! promise.then_with_value(global, cell, on_resolve, on_reject)?;
//!
//! // In on_resolve/on_reject, with `context: b.nativePromiseContext("crate::..::RequestContext")` in the schema:
//! let Some(ctx) = context else { return; };
//! // ... process; the ref drops with `ctx` ...
//! ```

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_event_loop::{Task, TaskTag, Taskable, task_tag};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_ptr::{AnyRefCounted, RefPtr};

use crate::api::html_rewriter;
use crate::api::server;
use crate::webcore::s3::multipart::NetworkSink;

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
pub(crate) enum Tag {
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
    /// `RewriterPipe` on behalf of a `PipePin`.
    HTMLRewriterPipeFree,
    /// The pump of an S3 stream upload (`NetworkSink`).
    S3UploadStream,
}

impl Tag {
    pub(crate) const COUNT: usize = 11;

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
            10 => Tag::S3UploadStream,
            _ => unreachable!(),
        }
    }
}

/// Maps a concrete native type to its `Tag`, expressed as a compile-time
/// mapping via a trait impl per type.
pub(crate) trait NativePromiseContextType: AnyRefCounted {
    const TAG: Tag;
}

// Layering note: blanket-impl over `ThisServer` so that ANY server
// type (mod.rs::NewServer or server_body::NewServer) yields the same Tag —
// the tag depends only on (SSL, DBG, MUX), never on the server type.
const fn npc_tag_for(ssl: bool, dbg: bool, mux: bool) -> Tag {
    match (ssl, dbg, mux) {
        (false, false, false) => Tag::HTTPServerRequestContext,
        (true, false, false) => Tag::HTTPSServerRequestContext,
        (false, true, false) => Tag::DebugHTTPServerRequestContext,
        (true, true, false) => Tag::DebugHTTPSServerRequestContext,
        (false, false, true) => Tag::HTTPServerMuxRequestContext,
        (true, false, true) => Tag::HTTPSServerMuxRequestContext,
        (false, true, true) => Tag::DebugHTTPServerMuxRequestContext,
        (true, true, true) => Tag::DebugHTTPSServerMuxRequestContext,
    }
}
impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> NativePromiseContextType
    for server::NewRequestContext<ThisServer, SSL, DBG, MUX>
where
    ThisServer: server::ServerLike + 'static,
{
    const TAG: Tag = npc_tag_for(SSL, DBG, MUX);
}
impl NativePromiseContextType for html_rewriter::RewriterPipe {
    const TAG: Tag = Tag::HTMLRewriterSuspension;
}
impl NativePromiseContextType for NetworkSink {
    const TAG: Tag = Tag::S3UploadStream;
}

// `&JSGlobalObject` is ABI-identical to a non-null pointer. `ctx` is stored
// opaquely (never dereferenced by the C++ side), so the FFI itself has no
// pointer-validity precondition.
unsafe extern "C" {
    safe fn Bun__NativePromiseContext__create(
        global: &JSGlobalObject,
        ctx: *mut c_void,
        tag: u8,
        held: JSValue,
    ) -> JSValue;
    safe fn Bun__NativePromiseContext__take(value: JSValue) -> *mut c_void;
    safe fn Bun__NativePromiseContext__takeHeld(value: JSValue) -> JSValue;
}

/// The cell owns `ctx` until `take()` transfers it back
/// or GC runs the destructor (which defers to [`DeferredDerefTask`]). `held`
/// is visited by the cell, so whatever GC object keeps `ctx` alive can ride
/// along for as long as the promise can settle; pass `JSValue::ZERO` when
/// nothing needs rooting.
pub(crate) fn create<T: NativePromiseContextType>(
    global: &JSGlobalObject,
    ctx: RefPtr<T>,
    held: JSValue,
) -> JSValue {
    Bun__NativePromiseContext__create(global, ctx.into_raw().cast(), T::TAG as u8, held)
}

/// Transfers the ref back to the caller and nulls the cell so the destructor
/// is a no-op. Returns null if already taken (e.g., the connection aborted
/// and the ref was released via the destructor on a prior GC cycle).
///
/// SAFETY: `cell` is a live cell that [`create`] made of a `T`.
pub(crate) unsafe fn take<T: NativePromiseContextType>(cell: JSValue) -> Option<RefPtr<T>> {
    let ctx = NonNull::new(Bun__NativePromiseContext__take(cell).cast::<T>())?;
    // SAFETY: the ref that `create` gave the cell.
    Some(unsafe { RefPtr::from_raw(ctx.as_ptr()) })
}

/// Clears the cell's `held` slot and returns its old value (`JSValue::ZERO` if it was empty).
pub(crate) fn take_held(cell: JSValue) -> JSValue {
    Bun__NativePromiseContext__takeHeld(cell)
}

/// Called from the C++ destructor when a cell is collected with a non-null
/// pointer (i.e., `take()` was never called — the Promise was GC'd without
/// settling).
///
/// The destructor runs during GC sweep, so it is NOT safe to do anything
/// that might touch the JSC heap. RequestContext.deref() can trigger
/// deinit() which aborts signals, unrefs bodies, and calls back into
/// the server — all of which may unprotect JS values or allocate. We must
/// defer that work to the event loop.
///
/// SAFETY: `ctx` and `tag` are what [`create`] gave the cell, which gives the ref up.
#[inline(never)]
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__NativePromiseContext__destroy(ctx: *mut c_void, tag: u8) {
    bun_removable_features::removable_definition!(Serve, Bun__NativePromiseContext__destroy);
    bun_removable_features::removable_definition!(HtmlRewriter, Bun__NativePromiseContext__destroy);
    bun_removable_features::removable_definition!(S3Client, Bun__NativePromiseContext__destroy);
    // SAFETY: fn contract.
    let claim = unsafe { Claim::from_raw(ctx, Tag::from_raw(tag)) };
    claim.clear_remembered_cell();
    DeferredDerefTask::schedule(claim);
}

macro_rules! claims {
    ($($Request:ident),*; $($Tag:ident($Type:ty)),*) => {
        /// One ref on what the [`Tag`] of the same name stands for.
        pub(crate) enum Claim {
            $($Request(RefPtr<$Request>),)*
            $($Tag(RefPtr<$Type>),)*
        }

        impl Claim {
            /// SAFETY: `ctx` is a ref on what `tag` stands for, which the caller gives up.
            unsafe fn from_raw(ctx: *mut c_void, tag: Tag) -> Self {
                // SAFETY: fn contract.
                unsafe {
                    match tag {
                        $(Tag::$Request => Self::$Request(RefPtr::from_raw(ctx.cast())),)*
                        $(Tag::$Tag => Self::$Tag(RefPtr::from_raw(ctx.cast())),)*
                    }
                }
            }

            fn into_raw(self) -> (*mut c_void, Tag) {
                match self {
                    $(Self::$Request(ctx) => (ctx.into_raw().cast(), Tag::$Request),)*
                    $(Self::$Tag(ctx) => (ctx.into_raw().cast(), Tag::$Tag),)*
                }
            }

            /// `promise_cell` is about to dangle, and `on_abort` reads it. A plain field write, safe during sweep.
            fn clear_remembered_cell(&self) {
                match self {
                    $(Self::$Request(ctx) => ctx.promise_cell_collected(),)*
                    $(Self::$Tag(_) => {})*
                }
            }
        }

        $(const _: () = assert!(align_of::<$Request>() > DeferredDerefTask::TAG_MASK);)*
        $(const _: () = assert!(align_of::<$Type>() > DeferredDerefTask::TAG_MASK);)*
    };
}
claims! {
    HTTPServerRequestContext,
    HTTPSServerRequestContext,
    DebugHTTPServerRequestContext,
    DebugHTTPSServerRequestContext,
    HTTPServerMuxRequestContext,
    HTTPSServerMuxRequestContext,
    DebugHTTPServerMuxRequestContext,
    DebugHTTPSServerMuxRequestContext;
    HTMLRewriterSuspension(html_rewriter::RewriterPipe),
    HTMLRewriterPipeFree(html_rewriter::RewriterPipe),
    S3UploadStream(NetworkSink)
}

/// Defers the GC-triggered deref to the next event-loop tick so it runs
/// outside the sweep phase.
///
/// A [`Claim`] in one word: the tag is in the pointer's low bits.
pub(crate) struct DeferredDerefTask(*mut c_void);

impl Taskable for DeferredDerefTask {
    const TAG: TaskTag = task_tag::NativePromiseContextDeferredDerefTask;
    type Payload = Self;
    /// The deref it defers is script-free, so do it.
    fn release_unrun(task: Self) {
        task.run_from_js_thread();
    }
    /// A deferred deref; calls no script.
    fn context(_: &Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl DeferredDerefTask {
    const TAG_MASK: usize = 0b1111;

    pub(crate) fn schedule(claim: Claim) {
        let vm = VirtualMachine::get();
        if vm.event_loop().is_closed_for_tasks() {
            // Teardown has forbidden script and released the queue; from here on only GC destructors
            // (possibly mid-sweep in `~VM`) reach this, and theirs is the last use of `ctx` in that
            // frame. A worker's HTMLRewriter pipe would outlive it, so those refs are released now,
            // sweep-safe; a RequestContext's deref is not sweep-safe and dies with the VM instead.
            match claim {
                Claim::HTMLRewriterSuspension(pipe) => pipe.abandon_suspension(),
                Claim::HTMLRewriterPipeFree(pipe) => drop(pipe),
                // The last ref only once the upload has finished and holds no JS value.
                Claim::S3UploadStream(sink) => drop(sink),
                request => {
                    request.into_raw();
                }
            }
            return;
        }

        let (ctx, tag) = claim.into_raw();
        let task = Self(ctx.map_addr(|addr| addr | tag as usize));
        vm.event_loop().enqueue_task(Task::new::<Self>(task));
    }

    pub(crate) fn run_from_js_thread(self) {
        let tag = Tag::from_raw((self.0.addr() & Self::TAG_MASK) as u8);
        let ctx = self.0.map_addr(|addr| addr & !Self::TAG_MASK);
        // SAFETY: what `schedule` packed.
        match unsafe { Claim::from_raw(ctx, tag) } {
            Claim::HTMLRewriterSuspension(pipe) => pipe.abandon_suspension(),
            // The pump's promise was collected unsettled: as a rejection with no reason.
            Claim::S3UploadStream(sink) => sink.on_pump_rejected(JSValue::ZERO),
            claim => drop(claim),
        }
    }
}

const _: () = assert!(Tag::COUNT <= DeferredDerefTask::TAG_MASK + 1);
