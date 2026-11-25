use bun_dotenv::Loader as DotEnvLoader;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use crate::ConcurrentTask::{BoxedTask, ConcurrentTask};
use crate::MiniEventLoop::MiniEventLoop;
use crate::{JsEventLoop, JsEventLoopKind};

// JS-event-loop arm of `AnyEventLoop` / `EventLoopHandle`.
//
// LAYERING: `bun_event_loop` is a lower tier than `bun_jsc`, so it cannot name
// `jsc::EventLoop` / `jsc::VirtualMachine` directly. To keep
// direct calls with no runtime registration, the concrete bodies live in
// `bun_jsc::event_loop` as `#[no_mangle]` Rust-ABI functions and are declared
// here as `extern "Rust"`. The linker resolves them at link time, so there is
// no vtable, no `AtomicPtr`, and no init-order hazard.
//
// The `Js` variant stores a [`JsEventLoop`] handle (the `link_interface!`
// newtype around the erased `*mut jsc::EventLoop`). The single `unsafe` is at
// handle construction (`JsEventLoop::new`); all dispatch sites are safe method
// calls.
unsafe extern "Rust" {
    /// `jsc::VirtualMachine::get().event_loop()` — erased `*mut jsc::EventLoop`
    /// for the current thread. Kept as a bare extern (no owner). No caller-side
    /// preconditions: panics (not UB) if no VM is bound on this thread.
    pub(crate) safe fn __bun_js_event_loop_current() -> *mut ();
}

/// Wrap an erased `*mut jsc::EventLoop` in a
/// [`JsEventLoop`] handle. The pointer is stored opaquely — never dereferenced
/// here — and the back-reference invariant (owner outlives every dispatch) is
/// documented on the public callers ([`AnyEventLoop::js`],
/// [`EventLoopHandle::init`]). Kept private so the safe public constructors
/// that take the opaque `*mut ()` are not flagged by
/// `clippy::not_unsafe_ptr_arg_deref` — the precondition is structural, not a
/// dereference.
#[inline]
fn jsc_event_loop_handle(js_event_loop: *mut ()) -> JsEventLoop {
    // SAFETY: stored opaquely; back-reference invariant (owner outlives every
    // dispatch) is the caller's structural guarantee.
    unsafe { JsEventLoop::new(JsEventLoopKind::Jsc, js_event_loop) }
}

/// Useful for code that may need an event loop and could be used from either JavaScript or directly without JavaScript.
/// Unlike jsc.EventLoopHandle, this owns the event loop when it's not a JavaScript event loop.
pub enum AnyEventLoop {
    Js {
        /// Typed handle wrapping the erased `*mut jsc::EventLoop`. The
        /// `link_interface!` invariant ("owner is live for every dispatch") is
        /// established once at construction; dispatch is safe.
        owner: JsEventLoop,
    },
    Mini(Box<MiniEventLoop>),
}

impl Default for AnyEventLoop {
    fn default() -> Self {
        AnyEventLoop::Mini(Box::new(MiniEventLoop::init()))
    }
}

impl AnyEventLoop {
    /// Owning thread: the weak poster other threads use to deliver JS-loop
    /// tasks to this loop's VM; `None` for a mini loop.
    pub fn js_poster(&self) -> Option<JsPoster> {
        match self {
            AnyEventLoop::Js { owner } => Some(owner.js_poster()),
            AnyEventLoop::Mini(_) => None,
        }
    }

    pub fn init() -> AnyEventLoop {
        AnyEventLoop::Mini(Box::new(MiniEventLoop::init()))
    }

    /// Construct the `Js` variant wrapping a specific erased
    /// `*mut jsc::EventLoop`.
    ///
    /// `js_event_loop` is a live erased `*mut jsc::EventLoop`
    /// that outlives every dispatch through the returned
    /// `AnyEventLoop`. The pointer is not dereferenced here — it's stored
    /// opaquely in [`JsEventLoop`] and only dereferenced at dispatch sites.
    #[inline]
    pub fn js(js_event_loop: *mut ()) -> AnyEventLoop {
        AnyEventLoop::Js {
            owner: jsc_event_loop_handle(js_event_loop),
        }
    }

    /// One turn of the loop, which waits if there is nothing to run.
    pub fn tick(&self, context: *mut core::ffi::c_void) {
        match self {
            AnyEventLoop::Js { owner } => {
                owner.tick();
                owner.auto_tick();
            }
            AnyEventLoop::Mini(mini) => mini.tick_once(context),
        }
    }
}

// ─────────────────────────── EventLoopHandle ───────────────────────────────
// MOVE-IN: relocated from `bun_jsc::EventLoopHandle`.
// Non-owning reference to either the JS event
// loop or the mini event loop. The `.js` arm holds a `JsEventLoop` handle
// (link-time-resolved dispatch; impls in `bun_jsc`).

#[derive(Copy, Clone)]
pub enum EventLoopHandle {
    Js {
        /// Typed handle wrapping the erased `*mut jsc::EventLoop` — see
        /// [`AnyEventLoop::Js`]. `JsEventLoop` is `Copy`, so the handle stays
        /// `Copy`.
        owner: JsEventLoop,
    },
    Mini(&'static MiniEventLoop),
}

/// Owned storage for either kind of concurrent task.
pub enum EventLoopTask {
    Js(ConcurrentTask),
    Mini(AnyTaskWithExtraContext),
}

impl EventLoopTask {
    pub fn from_event_loop(loop_: EventLoopHandle) -> EventLoopTask {
        match loop_ {
            EventLoopHandle::Js { .. } => EventLoopTask::Js(ConcurrentTask::default()),
            EventLoopHandle::Mini(_) => EventLoopTask::Mini(AnyTaskWithExtraContext::default()),
        }
    }
}

/// RAII pairing for [`EventLoopHandle::enter`] / [`EventLoopHandle::exit`].
/// Construct via [`EventLoopHandle::entered`]. `EventLoopHandle` is `Copy`, so
/// the guard owns its own copy and the caller may keep using the handle.
#[must_use = "dropping immediately exits the event loop scope"]
pub struct EnteredEventLoop(EventLoopHandle);

impl Drop for EnteredEventLoop {
    #[inline]
    fn drop(&mut self) {
        self.0.exit();
    }
}

impl EventLoopHandle {
    /// Wrap an erased `*mut jsc::EventLoop`. (Sibling constructors:
    /// `init_mini`, `js_current`; the `*VirtualMachine` form lives in
    /// bun_runtime since it must call `vm.eventLoop()`.)
    ///
    /// `js_event_loop` is a live erased `*mut jsc::EventLoop` whose owner
    /// outlives every dispatch through the returned handle. The pointer is not
    /// dereferenced here — it's stored opaquely in [`JsEventLoop`] and only
    /// dereferenced at dispatch sites. A null pointer is a documented sentinel
    /// for "never dispatched" placeholders (e.g. struct field initialisers
    /// that are overwritten before use).
    #[inline]
    pub fn init(js_event_loop: *mut ()) -> EventLoopHandle {
        EventLoopHandle::Js {
            owner: jsc_event_loop_handle(js_event_loop),
        }
    }

    /// The current thread's JS event loop, for callers that cannot name `VirtualMachine`.
    pub fn js_current() -> EventLoopHandle {
        EventLoopHandle::Js {
            owner: JsEventLoop::current(),
        }
    }

    /// A new mini loop, which is never freed.
    pub fn leak_mini() -> EventLoopHandle {
        EventLoopHandle::Mini(Box::leak(Box::new(MiniEventLoop::init())))
    }

    #[inline]
    pub fn init_mini(mini: &'static MiniEventLoop) -> EventLoopHandle {
        EventLoopHandle::Mini(mini)
    }

    #[inline]
    pub fn as_event_loop_ctx(self) -> bun_io::EventLoopCtx {
        match self {
            EventLoopHandle::Js { owner } => owner.event_loop_ctx(),
            EventLoopHandle::Mini(mini) => mini.as_event_loop_ctx(),
        }
    }

    /// Erase to the `(tag, ptr)` pair stored in `uws::InternalLoopData`
    /// (`parent_tag` / `parent_ptr`). Tag 1 = JS, tag 2 = mini.
    #[inline]
    fn into_tag_ptr(self) -> (core::ffi::c_char, *mut core::ffi::c_void) {
        match self {
            EventLoopHandle::Js { owner, .. } => (1, owner.owner().cast()),
            EventLoopHandle::Mini(mini) => (2, core::ptr::from_ref(mini).cast_mut().cast()),
        }
    }

    /// Inverse of [`into_tag_ptr`] — recover from the `(tag, ptr)` pair stored
    /// in `uws::InternalLoopData`.
    ///
    /// `(tag, ptr)` must have been produced by [`into_tag_ptr`] on a still-live
    /// event loop (i.e. read from `internal_loop_data` while the loop is alive).
    ///
    /// # Safety
    /// `(tag, ptr)` must have been produced by [`into_tag_ptr`] on a still-live
    /// event loop. The constructor itself only stores the opaque pointer, but
    /// dispatch through the resulting handle dereferences it — this fn is the
    /// last place the precondition can be discharged. (NOT eligible for
    /// `unsafe-fn-narrow`: the invariant is caller-provided, not internally
    /// guarded.)
    #[inline]
    pub unsafe fn from_tag_ptr(
        tag: core::ffi::c_char,
        ptr: *mut core::ffi::c_void,
    ) -> EventLoopHandle {
        match tag {
            1 => EventLoopHandle::Js {
                // SAFETY: `(tag, ptr)` was produced by `into_tag_ptr` on a
                // still-live event loop, so `ptr` is a live erased
                // `*mut jsc::EventLoop`. Same boundary as `EventLoopHandle::init`.
                owner: unsafe { JsEventLoop::new(JsEventLoopKind::Jsc, ptr.cast::<()>()) },
            },
            // SAFETY: `into_tag_ptr` made `ptr` from a `&'static MiniEventLoop`.
            2 => EventLoopHandle::Mini(unsafe { &*ptr.cast() }),
            _ => unreachable!("invalid parent event-loop tag {}", tag),
        }
    }
}

impl EventLoopHandle {
    #[inline]
    pub fn set_as_parent_of(self, uws_loop: &UwsLoop) {
        let (tag, ptr) = self.into_tag_ptr();
        uws_loop.internal_loop_data.set_parent_raw(tag, ptr);
    }

    pub fn iteration_number(self) -> u64 {
        match self {
            EventLoopHandle::Js { owner } => owner.iteration_number(),
            EventLoopHandle::Mini(mini) => mini.loop_.iteration_number(),
        }
    }

    /// As [`AnyEventLoop::tick`].
    pub fn tick(self, context: *mut core::ffi::c_void) {
        match self {
            EventLoopHandle::Js { owner } => {
                owner.tick();
                owner.auto_tick();
            }
            EventLoopHandle::Mini(mini) => mini.tick_once(context),
        }
    }

    pub fn tick_once(self, context: *mut core::ffi::c_void) {
        match self {
            EventLoopHandle::Js { owner } => {
                owner.tick();
                owner.auto_tick_active();
            }
            EventLoopHandle::Mini(mini) => mini.tick_without_idle(context),
        }
    }

    /// Erased `*mut jsc::JSGlobalObject` or null (Mini has no JS global).
    pub fn global_object(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.global_object(),
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    /// Erased `*mut jsc::VirtualMachine` or null.
    pub fn bun_vm(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.bun_vm(),
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    pub fn enter(self) {
        if let EventLoopHandle::Js { owner } = self {
            owner.enter();
        }
    }

    pub fn exit(self) {
        if let EventLoopHandle::Js { owner } = self {
            owner.exit();
        }
    }

    /// `enter()` and return an RAII guard that `exit()`s on drop. Prefer this
    /// over a bare `enter()`/`exit()` pair so early returns and `?` don't leak
    /// the entered scope.
    #[inline]
    pub fn entered(self) -> EnteredEventLoop {
        self.enter();
        EnteredEventLoop(self)
    }

    /// Owning thread: the weak poster other threads use to deliver JS-loop
    /// tasks to this handle's VM; `None` for a mini loop (post to it directly —
    /// it is owned by, and outlives the work of, its thread).
    pub fn js_poster(&self) -> Option<JsPoster> {
        match self {
            EventLoopHandle::Js { owner } => Some(owner.js_poster()),
            EventLoopHandle::Mini(_) => None,
        }
    }

    pub fn r#loop(self) -> &'static UwsLoop {
        match self {
            EventLoopHandle::Js { owner } => owner.uws_loop(),
            EventLoopHandle::Mini(mini) => mini.loop_,
        }
    }

    #[inline]
    pub fn platform_event_loop(self) -> &'static UwsLoop {
        self.r#loop()
    }

    /// Alias for [`r#loop`](Self::r#loop) so callers spell `handle.loop_()`
    /// without the raw-identifier escape.
    #[inline]
    pub fn loop_(self) -> &'static UwsLoop {
        self.r#loop()
    }

    #[cfg(windows)]
    #[inline]
    pub fn uv_loop(self) -> *mut bun_io::Loop {
        self.r#loop().uv_loop()
    }

    pub fn env(self) -> *mut DotEnvLoader {
        match self {
            EventLoopHandle::Js { owner } => owner.env(),
            // `env` must be set — caller invariant. `env_ptr()` takes
            // `&self` and returns `Option<NonNull<DotEnvLoader>>` (mutable
            // provenance).
            EventLoopHandle::Mini(mini) => mini
                .env_ptr()
                .expect("MiniEventLoop.env unset")
                .as_ptr()
                .cast(),
        }
    }
}

// ─────────────────────────── JsPoster ──────────────────────────────────────
//
// How code below `bun_jsc` reaches a JS VM from another thread: an erased,
// *uncounted* `bun_jsc::VmHandle` (`bun_jsc` implements the trait) — what something
// that merely refers to a VM holds (spawn's process-wide waiter thread, a
// bundle owned by a JS loop). Its `post` is deliver-or-refuse: once the VM has
// closed, the task comes back and the caller releases it — its own payload —
// on its own thread. Work that a VM must *wait* for holds a `bun_jsc::Ticket`
// instead, which implements `PostToJs` too and never refuses.

/// Result of a weak post to a JS loop from another thread: it was queued, or
/// the loop's VM is closed and the caller has the task back to release on this
/// thread.
#[must_use = "a refused task must be released by its producer"]
pub enum Posted<T = Box<ConcurrentTask>> {
    Queued,
    Refused(T),
}

pub trait PostToJs: Send + Sync {
    /// Queue `task` on the VM this poster was created for and wake it, or hand it back if the VM has closed.
    fn post(&self, task: Box<ConcurrentTask>) -> Posted;
}

impl dyn PostToJs + '_ {
    /// As [`post`](PostToJs::post). A refused task is dropped on this thread.
    pub fn post_boxed<T: BoxedTask>(&self, task: Box<T>) {
        if let Posted::Refused(node) = self.post(ConcurrentTask::create_boxed(task)) {
            // SAFETY: the task made above.
            drop(unsafe { node.task.into_boxed::<T>() });
        }
    }
}

pub type JsPoster = std::sync::Arc<dyn PostToJs>;
