use core::ptr;

use bun_sys::Fd;
use bun_sys::windows::libuv as uv;
use bun_uws_sys::WindowsLoop;

use crate::posix_event_loop as posix;
// Shared scaffolding lives in `posix_event_loop` (platform-agnostic types);
// only `FilePoll`/`Store`/`KeepAlive`/`Closer`/`Loop`/`Waker` are redefined
// here. `Flags`/`Owner`/etc. are re-aliased below from `posix` for callers
// that name them via this module.
pub use crate::posix_event_loop::{
    AllocatorType, EventLoopCtx, OpaqueCallback, get_vm_ctx, js_vm_ctx,
};

bun_core::declare_scope!(KeepAlive, visible);
bun_core::declare_scope!(FilePoll, visible);

// `Loop` here is the raw
// `uv_loop_t`. (`WindowsLoop` is the uws wrapper that *owns* a `*mut uv::Loop`
// in its `.uv_loop` field; callers that hold a `WindowsLoop*` project that
// field themselves. See `VirtualMachine::event_loop_handle` /
// `SpawnSyncEventLoop` which store/compare the inner `uv::Loop` pointer.)
pub type Loop = uv::Loop;

// `KeepAlive` (struct + 14-method impl) was duplicated here and in
// `posix_event_loop.rs`; both copies now live in `crate::keep_alive`.

pub type Flags = posix::Flags;
pub type FlagsSet = posix::FlagsSet;
pub(crate) type FlagsStruct = posix::FlagsStruct;
pub type Owner = posix::Owner;

pub struct FilePoll {
    pub fd: Fd,
    pub owner: Owner,
    pub flags: FlagsSet,
    pub next_to_free: *mut FilePoll,
}

impl FilePoll {
    posix::impl_file_poll_flag_methods!();

    #[inline]
    pub fn is_keeping_process_alive(&self) -> bool {
        !self.flags.contains(Flags::Closed) && self.is_active()
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable_keeping_process_alive(&mut self, vm: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.insert(Flags::Closed);

        vm.loop_sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
    }

    pub fn init(vm: EventLoopCtx, fd: Fd, flags: FlagsStruct, owner: Owner) -> *mut FilePoll {
        Self::init_with_owner(vm, fd, flags, owner)
    }

    pub fn init_with_owner(
        vm: EventLoopCtx,
        fd: Fd,
        flags: FlagsStruct,
        owner: Owner,
    ) -> *mut FilePoll {
        // Crate-private backref-deref accessor — single live `&mut Store` borrow.
        vm.file_polls_mut()
            .get_init(FilePoll {
                fd,
                flags,
                owner,
                next_to_free: ptr::null_mut(),
            })
            .as_ptr()
    }

    // Note: not `impl Drop` — FilePoll lives in a HiveArray pool slot, not a Box;
    // teardown returns the slot to the pool via `Store::put`.
    pub fn deinit(&mut self) {
        self.deinit_with_vm(js_vm_ctx());
    }

    pub fn deinit_force_unregister(&mut self) {
        self.deinit()
    }

    pub fn unregister(&mut self, _loop: &mut WindowsLoop) -> bool {
        // TODO: This cast is extremely suspicious. At best, `fd` is
        // the wrong type (it should be a uv handle), at worst this code is a
        // crash due to invalid memory access.
        //
        // SAFETY: in practice this call is unreachable. On Windows nothing
        // ever sets the `Poll*` registration flags after construction (this
        // module defines no `register`), and every in-tree constructor passes
        // empty/default flags, so `is_registered()` stays false and
        // `deinit_possibly_defer` — the only path here — never takes the
        // `unregister` branch. If a Windows registration path is ever added,
        // this cast must be replaced with a real `uv_handle_t` pointer first
        // (see TODO above); `uv_unref` dereferences its argument.
        unsafe {
            uv::uv_unref(self.fd.0 as *mut uv::uv_handle_t);
        }
        true
    }

    fn deinit_possibly_defer(&mut self, vm: EventLoopCtx, loop_: &mut WindowsLoop) {
        if self.is_registered() {
            let _ = self.unregister(loop_);
        }

        let was_ever_registered = self.flags.contains(Flags::WasEverRegistered);
        self.flags = FlagsSet::default();
        self.fd = Fd::INVALID;
        // All `self` field writes are done. Decay `self` to a raw slot pointer
        // *before* materializing `&mut Store` so the `&mut Store` borrow (which
        // covers the inline hive buffer) is the only live unique reference into
        // that allocation when `Store::put` runs. `self` is never touched after
        // this line — `Store::put` itself accesses `this` only via raw-pointer ops.
        let this: ptr::NonNull<FilePoll> = ptr::NonNull::from(&mut *self);
        // `file_polls_mut()` is the per-thread set-once `Store` back-pointer
        // (`BackRef`-shaped); `&mut self` has been retired to `this` above so
        // the `&mut Store` it produces is the sole unique borrow into the hive.
        vm.file_polls_mut().put(this, vm, was_ever_registered);
    }

    pub fn deinit_with_vm(&mut self, vm: EventLoopCtx) {
        // `loop_mut()` — crate-private nonnull-asref accessor (single deref in
        // `EventLoopCtx`); the uws loop is a disjoint allocation from `self`.
        // Stacked-Borrows: `self` may live inside `Store.hive`'s inline buffer,
        // so `&mut Store` is materialised only *after* `&mut self` is retired
        // inside `deinit_possibly_defer` (via `file_polls_mut()`).
        let loop_ = vm.loop_mut();
        self.deinit_possibly_defer(vm, loop_);
    }

    pub fn enable_keeping_process_alive(&mut self, vm: EventLoopCtx) {
        if !self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.remove(Flags::Closed);

        vm.loop_add_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
    }

    pub fn can_activate(&self) -> bool {
        !self.flags.contains(Flags::HasIncrementedPollCount)
    }

    /// Only intended to be used from EventLoop.Pollable
    // Note: the cycle-broken `EventLoopCtx::platform_event_loop` vtable is typed
    // `*mut bun_uws_sys::Loop` (the uws `WindowsLoop` wrapper) so the
    // impl-crate bodies (`VirtualMachine::uws_loop` / `MiniEventLoop::loop_ptr`)
    // type-check. `WindowsLoop::sub_active`/`add_active` proxy straight through
    // to `(*self.uv_loop).{sub,add}_active`, so accept the wrapper here.
    pub fn deactivate(&mut self, loop_: &mut WindowsLoop) {
        debug_assert!(self.flags.contains(Flags::HasIncrementedPollCount));
        loop_.sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
        bun_core::scoped_log!(FilePoll, "deactivate - {}", loop_.uv().active_handles);
        self.flags.remove(Flags::HasIncrementedPollCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(&mut self, loop_: &mut WindowsLoop) {
        loop_.add_active(
            (!self.flags.contains(Flags::Closed)
                && !self.flags.contains(Flags::HasIncrementedPollCount)) as u32,
        );
        bun_core::scoped_log!(FilePoll, "activate - {}", loop_.uv().active_handles);
        self.flags.insert(Flags::HasIncrementedPollCount);
    }

    #[inline]
    pub fn can_ref(&self) -> bool {
        if self.flags.contains(Flags::Closed) {
            return false;
        }

        !self.flags.contains(Flags::HasIncrementedPollCount)
    }

    pub fn on_ended(&mut self, event_loop_ctx: EventLoopCtx) {
        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.insert(Flags::Closed);
        // this.deactivate(vm.event_loop_handle.?);
        self.deactivate(event_loop_ctx.loop_mut());
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, vm: EventLoopCtx) {
        if !self.can_unref() {
            return;
        }
        bun_core::scoped_log!(FilePoll, "unref");
        // this.deactivate(vm.event_loop_handle.?);
        self.deactivate(vm.loop_mut());
    }

    /// Allow a poll to keep the process alive.
    // pub fn ref(this: *FilePoll, vm: *jsc.VirtualMachine) void {
    pub fn ref_(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.can_ref() {
            return;
        }
        bun_core::scoped_log!(FilePoll, "ref");
        // this.activate(vm.event_loop_handle.?);
        self.activate(event_loop_ctx.loop_mut());
    }
}

pub type Store = posix::PollStore<FilePoll>;

posix::impl_poll_slot!(FilePoll);

pub struct Waker {
    // `BackRef<WindowsLoop>`: `WindowsLoop::get()` hands out the shared
    // process-global singleton; the pointee strictly outlives every `Waker`.
    // Safe `Deref` only — `wait`/`wake` route the raw `as_ptr()` straight to
    // the C entry points so no `&mut WindowsLoop` is ever materialised (a
    // concurrent `wake()` from a worker thread cannot alias).
    loop_: bun_ptr::BackRef<WindowsLoop>,
}
// SAFETY: `Waker::wake()` only forwards to `WindowsLoop::wakeup()`, which is
// the documented cross-thread wake path (uv_async_send under the hood).
unsafe impl Send for Waker {}
unsafe impl Sync for Waker {}

impl Waker {
    // `Result` kept (despite being infallible here) for signature parity with
    // the POSIX wakers, whose `init` can fail (eventfd / kqueue).
    pub fn init() -> Result<Waker, crate::Error> {
        Ok(Waker {
            loop_: bun_ptr::BackRef::from(
                ptr::NonNull::new(WindowsLoop::get()).expect("WindowsLoop::get() singleton"),
            ),
        })
    }

    /// The libuv loop backing the process-global `WindowsLoop`. Exposed so
    /// callers that need a bare `uv_loop_t*` (e.g. `BundleThread`'s keep-alive
    /// timer) can wire libuv handles without holding a `&WindowsLoop` borrow
    /// against the shared global.
    #[inline]
    pub fn uv_loop(&self) -> *mut uv::Loop {
        // `BackRef` deref is safe (pointee outlives holder); `uv_loop` is a
        // `Copy` field set once by `us_create_loop` and immutable for the
        // process.
        self.loop_.uv_loop
    }

    // `getFd`/`initWithFileDescriptor` must never be referenced on Windows,
    // so they are simply not defined here — POSIX-only call sites are
    // `cfg`-gated, so a stray Windows use fails the build.

    pub fn wait(&self) {
        // Do NOT go through `WindowsLoop::wait(&mut self)`: that would
        // materialize a `&mut WindowsLoop` over the process-global singleton
        // for the entire duration of `us_loop_run`/`uv_run`, and a concurrent
        // `wake()` from a worker thread would alias it (two live `&mut T` to
        // one allocation = UB under Stacked/Tree Borrows). Call the C entry
        // point with the raw pointer directly — no exclusivity claimed.
        // SAFETY: `loop_` is the live `WindowsLoop::get()` singleton.
        unsafe { waker_c::us_loop_run(self.loop_.as_ptr()) };
    }

    pub fn wake(&self) {
        // See `wait()` — call the thread-safe C wake path with the raw pointer
        // instead of forming a `&mut WindowsLoop` that would alias the
        // event-loop thread's borrow held across `us_loop_run`.
        // SAFETY: `loop_` is the live `WindowsLoop::get()` singleton;
        // `us_wakeup_loop` → `uv_async_send` is documented thread-safe.
        unsafe { waker_c::us_wakeup_loop(self.loop_.as_ptr()) };
    }
}

// Local extern shims for `Waker`: the canonical decls live in
// `bun_uws_sys::loop_::c` but that module is crate-private. Re-declaring the
// two symbols here lets `Waker::{wait,wake}` pass the raw `*mut WindowsLoop`
// without round-tripping through a `&mut self` receiver (see comments above).
mod waker_c {
    use super::WindowsLoop;
    unsafe extern "C" {
        pub(super) fn us_loop_run(loop_: *mut WindowsLoop);
        pub(super) fn us_wakeup_loop(loop_: *mut WindowsLoop);
    }
}

// `Closer` (struct + close/on_close) was duplicated here and in
// `crate::closer` (lib.rs); the canonical one is re-exported as
// `bun_io::Closer`. No callers referenced `windows_event_loop::Closer`.
