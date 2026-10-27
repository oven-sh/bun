use core::ptr::NonNull;

use bun_dotenv::Loader as DotEnvLoader;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use crate::ConcurrentTask::ConcurrentTask;
use crate::MiniEventLoop::{MiniEventLoop, Shared as MiniShared};
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
        Self::init()
    }
}

impl AnyEventLoop {
    pub fn iteration_number(&self) -> u64 {
        match self {
            AnyEventLoop::Js { owner } => owner.iteration_number(),
            AnyEventLoop::Mini(mini) => mini.loop_.iteration_number(),
        }
    }

    pub fn init() -> AnyEventLoop {
        AnyEventLoop::Mini(Box::new(MiniEventLoop::init()))
    }

    /// Construct the `Js` variant for the current thread's JS event loop.
    /// Replaces `jsc::VirtualMachine::get().event_loop()` for tier-≤4 callers
    /// (e.g. `bun_install::PackageManager`).
    pub fn js_current() -> AnyEventLoop {
        AnyEventLoop::Js {
            owner: JsEventLoop::current(),
        }
    }

    /// Runs the loop until `is_done(context)`. `context` is also what a mini loop's tasks get.
    pub fn tick(
        &self,
        context: *mut core::ffi::c_void,
        is_done: fn(*mut core::ffi::c_void) -> bool,
    ) {
        match self {
            AnyEventLoop::Js { owner } => {
                while !is_done(context) {
                    owner.tick();
                    owner.auto_tick();
                }
            }
            AnyEventLoop::Mini(mini) => mini.tick(context, is_done),
        }
    }

    pub fn tick_once(&self, context: *mut core::ffi::c_void) {
        match self {
            AnyEventLoop::Js { owner } => {
                owner.tick();
                owner.auto_tick_active();
            }
            AnyEventLoop::Mini(mini) => mini.tick_without_idle(context),
        }
    }
}

impl AnyEventLoop {
    #[inline]
    pub fn r#loop(&self) -> &UwsLoop {
        match self {
            // SAFETY: whoever made `owner` promised that its uws loop outlives it
            // (`EventLoopHandle::init`). `Self` is `!Send`, so this is the loop's thread.
            AnyEventLoop::Js { owner } => unsafe { &*owner.uws_loop() },
            AnyEventLoop::Mini(mini) => mini.loop_,
        }
    }

    /// Platform-native loop (`us_loop_t*` on POSIX, `uv_loop_t*` on
    /// Windows). See [`bun_io::uws_to_native`].
    #[inline]
    pub fn native_loop(&self) -> &bun_io::Loop {
        bun_io::uws_to_native(self.r#loop())
    }

    /// What another thread wakes this loop with.
    ///
    /// # Safety
    /// As [`LoopWaker::new`], for the uws loop this loop runs on.
    #[inline]
    pub unsafe fn waker(&self) -> LoopWaker {
        // SAFETY: fn contract.
        unsafe { LoopWaker::new(self.r#loop()) }
    }
}

/// Wakes a uws loop from any thread.
#[derive(Clone, Copy)]
pub struct LoopWaker(NonNull<UwsLoop>);

// SAFETY: the pointer only goes to `us_wakeup_loop`, which any thread may call on a live loop.
unsafe impl Send for LoopWaker {}
// SAFETY: as above.
unsafe impl Sync for LoopWaker {}

impl LoopWaker {
    /// # Safety
    /// `loop_` is not freed while a thread can still call [`wake`](Self::wake) on the result or on
    /// a copy of it.
    #[inline]
    pub unsafe fn new(loop_: &UwsLoop) -> LoopWaker {
        LoopWaker(NonNull::from(loop_))
    }

    #[inline]
    pub fn wake(&self) {
        // SAFETY: live (`new`'s contract).
        unsafe { bun_uws::us_wakeup_loop(self.0.as_ptr()) };
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

// Fails to compile ("multiple applicable items") if a handle could leave its loop's thread.
const _: () = {
    trait AmbiguousIfImpl<A> {
        fn some_item() {}
    }
    impl<T: ?Sized> AmbiguousIfImpl<()> for T {}
    impl<T: ?Sized + Send> AmbiguousIfImpl<u8> for T {}
    impl<T: ?Sized + Sync> AmbiguousIfImpl<u16> for T {}
    let _ = <EventLoopHandle as AmbiguousIfImpl<_>>::some_item;
    let _ = <AnyEventLoop as AmbiguousIfImpl<_>>::some_item;
};

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
    /// Wrap an erased `*mut jsc::EventLoop`. `jsc::EventLoop::handle` is the safe form.
    ///
    /// # Safety
    /// The `jsc::EventLoop`, and the uws loop it runs on, outlive every use of the result and its
    /// copies.
    #[inline]
    pub unsafe fn init(js_event_loop: *mut ()) -> EventLoopHandle {
        EventLoopHandle::Js {
            // SAFETY: fn contract.
            owner: unsafe { JsEventLoop::new(JsEventLoopKind::Jsc, js_event_loop) },
        }
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

    /// [`into_tag_ptr`](Self::into_tag_ptr) of the handle for an erased `*mut jsc::EventLoop`.
    #[inline]
    pub fn js_tag_ptr(js_event_loop: *mut ()) -> (core::ffi::c_char, *mut core::ffi::c_void) {
        (1, js_event_loop.cast())
    }

    /// Erase to the `(tag, ptr)` pair stored in `uws::InternalLoopData`
    /// (`parent_tag` / `parent_ptr`). Tag 1 = JS, tag 2 = mini.
    #[inline]
    pub fn into_tag_ptr(self) -> (core::ffi::c_char, *mut core::ffi::c_void) {
        match self {
            EventLoopHandle::Js { owner, .. } => Self::js_tag_ptr(owner.owner),
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
            // SAFETY: `ptr` is the `&'static MiniEventLoop` that `into_tag_ptr` erased.
            2 => EventLoopHandle::Mini(unsafe { &*ptr.cast::<MiniEventLoop>() }),
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

    /// `'static`, because the handle and its copies point into a mini loop that `any` owns.
    pub fn from_any(any: &'static AnyEventLoop) -> EventLoopHandle {
        match any {
            AnyEventLoop::Js { owner } => EventLoopHandle::Js { owner: *owner },
            AnyEventLoop::Mini(mini) => EventLoopHandle::Mini(mini),
        }
    }

    /// Erased `*mut jsc::JSGlobalObject` or null (Mini has no JS global).
    pub fn global_object(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.global_object(),
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

    /// Owning thread: what other threads deliver tasks to this loop through.
    pub fn poster(&self) -> Poster {
        match self {
            EventLoopHandle::Js { owner } => Poster::Js(owner.js_poster()),
            EventLoopHandle::Mini(mini) => Poster::Mini(&mini.shared),
        }
    }

    pub fn r#loop(&self) -> &UwsLoop {
        match self {
            // SAFETY: whoever made `owner` promised that its uws loop outlives it (`init`). `Self`
            // is `!Send`, so this is the loop's thread.
            EventLoopHandle::Js { owner } => unsafe { &*owner.uws_loop() },
            EventLoopHandle::Mini(mini) => mini.loop_,
        }
    }

    #[inline]
    pub fn platform_event_loop(&self) -> &UwsLoop {
        self.r#loop()
    }

    /// Platform-native loop (`us_loop_t*` on POSIX, `uv_loop_t*` on
    /// Windows). See [`bun_io::uws_to_native`].
    #[inline]
    pub fn native_loop(&self) -> &bun_io::Loop {
        bun_io::uws_to_native(self.r#loop())
    }

    /// Windows convenience alias for [`native_loop`](Self::native_loop)
    /// (kept for existing `cfg(windows)` callers that spell `uv_loop`).
    #[cfg(windows)]
    #[inline]
    pub fn uv_loop(&self) -> &bun_io::Loop {
        self.native_loop()
    }

    pub fn env(self) -> *mut DotEnvLoader {
        match self {
            EventLoopHandle::Js { owner } => owner.env(),
            // `env` must be set — caller invariant.
            EventLoopHandle::Mini(mini) => mini.env.expect("MiniEventLoop.env unset").as_ptr(),
        }
    }

    pub fn top_level_dir(self) -> &'static [u8] {
        match self {
            // SAFETY: slice borrowed for VM lifetime.
            EventLoopHandle::Js { owner } => unsafe { &*owner.top_level_dir() },
            EventLoopHandle::Mini(mini) => &mini.top_level_dir,
        }
    }

    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        match self {
            EventLoopHandle::Js { owner } => owner.create_null_delimited_env_map(),
            EventLoopHandle::Mini(mini) => {
                // `env` must be set (caller invariant).
                let env = mini.env.expect("MiniEventLoop.env unset");
                // SAFETY: the loader is never freed (see `MiniEventLoop::env`).
                unsafe { (*env.as_ptr()).map.create_null_delimited_env_map() }
            }
        }
    }
}

/// How another thread delivers a task to the loop an [`EventLoopHandle`] names. The handle itself
/// stays on the loop's thread.
pub enum Poster {
    Js(JsPoster),
    Mini(&'static MiniShared),
}

// ─────────────────────────── JsPoster ──────────────────────────────────────
//
// How code below `bun_jsc` reaches a JS VM from another thread: an erased,
// *uncounted* `bun_jsc::VmHandle` (`bun_jsc` fills the vtable) — what something
// that merely refers to a VM holds (spawn's process-wide waiter thread, a
// bundle owned by a JS loop). Its `post` is deliver-or-refuse: once the VM has
// closed, the task comes back and the caller releases it — its own payload —
// on its own thread. Work that a VM must *wait* for holds a `bun_jsc::Ticket`
// instead (a `Bun.build`'s completion task carries one for the bundle thread).

/// Result of a weak post to a JS loop from another thread: it was queued, or
/// the loop's VM is closed and the caller has the task back to release on this
/// thread.
#[must_use = "a refused task must be released by its producer"]
pub enum Posted {
    Queued,
    Refused(NonNull<ConcurrentTask>),
}

pub struct JsPosterVTable {
    pub post: unsafe fn(data: *const (), task: NonNull<ConcurrentTask>) -> Posted,
    pub clone: unsafe fn(data: *const ()) -> *const (),
    pub drop: unsafe fn(data: *const ()),
}

pub struct JsPoster {
    data: *const (),
    vtable: &'static JsPosterVTable,
}

// SAFETY: `data` is an erased `Arc<VmHandle inner>`; the vtable fns are the
// thread-safe VmHandle operations.
unsafe impl Send for JsPoster {}
// SAFETY: as above.
unsafe impl Sync for JsPoster {}

impl JsPoster {
    /// # Safety
    /// `data`/`vtable` come from one of `bun_jsc::vm_handle`'s `to_js_poster`
    /// implementations (`VmHandle` / the isolated poster).
    #[inline]
    pub unsafe fn from_raw(data: *const (), vtable: &'static JsPosterVTable) -> Self {
        Self { data, vtable }
    }

    /// Queue `task` on the VM this poster was created for and wake it, or hand
    /// it back if the VM has closed.
    #[inline]
    pub fn post(&self, task: NonNull<ConcurrentTask>) -> Posted {
        // SAFETY: vtable contract.
        unsafe { (self.vtable.post)(self.data, task) }
    }
}

impl Clone for JsPoster {
    fn clone(&self) -> Self {
        Self {
            // SAFETY: vtable contract.
            data: unsafe { (self.vtable.clone)(self.data) },
            vtable: self.vtable,
        }
    }
}

impl Drop for JsPoster {
    fn drop(&mut self) {
        // SAFETY: vtable contract.
        unsafe { (self.vtable.drop)(self.data) }
    }
}
