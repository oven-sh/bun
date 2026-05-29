use core::ffi::c_void;
use core::ptr;

use bun_sys::Fd;
use bun_sys::windows::libuv as uv;
use bun_uws_sys::WindowsLoop;

use crate::posix_event_loop as posix;
pub use crate::posix_event_loop::{
    AllocatorType, EventLoopCtx, OpaqueCallback, get_vm_ctx, js_vm_ctx,
};

bun_core::declare_scope!(KeepAlive, visible);
bun_core::declare_scope!(FilePoll, visible);

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
    #[inline]
    pub fn is_active(&self) -> bool {
        self.flags.contains(Flags::HasIncrementedPollCount)
    }

    #[inline]
    pub fn is_watching(&self) -> bool {
        !self.flags.contains(Flags::NeedsRearm)
            && (self.flags.contains(Flags::PollReadable)
                || self.flags.contains(Flags::PollWritable)
                || self.flags.contains(Flags::PollProcess))
    }

    #[inline]
    pub fn is_keeping_process_alive(&self) -> bool {
        !self.flags.contains(Flags::Closed) && self.is_active()
    }

    pub fn is_registered(&self) -> bool {
        self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport)
    }

    /// Make calling ref() on this poll into a no-op.
    // pub fn disableKeepingProcessAlive(this: *FilePoll, vm: *jsc.VirtualMachine) void {
    pub fn disable_keeping_process_alive(&mut self, vm: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.insert(Flags::Closed);

        vm.loop_sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
        // vm.event_loop_handle.?.active_handles -= @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
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

    // PORT NOTE: not `impl Drop` — FilePoll lives in a HiveArray pool slot, not a Box;
    // teardown returns the slot to the pool via `Store::put`.
    pub fn deinit(&mut self) {
        self.deinit_with_vm(js_vm_ctx());
    }

    #[inline]
    pub fn file_descriptor(&self) -> Fd {
        self.fd
    }

    pub fn deinit_force_unregister(&mut self) {
        self.deinit()
    }

    pub fn unregister(&mut self, _loop: &mut WindowsLoop) -> bool {
        // TODO: This cast is extremely suspicious. At best, `fd` is
        // the wrong type (it should be a uv handle), at worst this code is a
        // crash due to invalid memory access.
        //
        // Zig does `@ptrFromInt(@as(u64, @bitCast(this.fd)))`; `Fd` is
        // `#[repr(transparent)]` over `u64` on Windows, so the bitcast is just
        // the public backing field.
        // SAFETY: see TODO above — preserved verbatim from Zig.
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
        let this: ptr::NonNull<FilePoll> = ptr::NonNull::from(&mut *self);
        // `file_polls_mut()` is the per-thread set-once `Store` back-pointer
        // (`BackRef`-shaped); `&mut self` has been retired to `this` above so
        // the `&mut Store` it produces is the sole unique borrow into the hive.
        vm.file_polls_mut().put(this, vm, was_ever_registered);
    }

    pub fn is_readable(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Readable);
        self.flags.remove(Flags::Readable);
        readable
    }

    pub fn is_hup(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Hup);
        self.flags.remove(Flags::Hup);
        readable
    }

    pub fn is_eof(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Eof);
        self.flags.remove(Flags::Eof);
        readable
    }

    pub fn clear_event(&mut self, flag: Flags) {
        self.flags.remove(flag);
    }

    pub fn is_writable(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Writable);
        self.flags.remove(Flags::Writable);
        readable
    }

    pub fn deinit_with_vm(&mut self, vm: EventLoopCtx) {
        let loop_ = vm.loop_mut();
        self.deinit_possibly_defer(vm, loop_);
    }

    pub fn enable_keeping_process_alive(&mut self, vm: EventLoopCtx) {
        if !self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.remove(Flags::Closed);

        // vm.event_loop_handle.?.active_handles += @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
        vm.loop_add_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
    }

    pub fn can_activate(&self) -> bool {
        !self.flags.contains(Flags::HasIncrementedPollCount)
    }

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

    #[inline]
    pub fn can_unref(&self) -> bool {
        self.flags.contains(Flags::HasIncrementedPollCount)
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

type FilePollHiveArray = bun_collections::hive_array::Fallback<FilePoll, 128>;

pub struct Store {
    hive: FilePollHiveArray,
    pending_free_head: *mut FilePoll,
    pending_free_tail: *mut FilePoll,
}

impl Store {
    pub fn init() -> Store {
        Store {
            hive: FilePollHiveArray::init(),
            pending_free_head: ptr::null_mut(),
            pending_free_tail: ptr::null_mut(),
        }
    }

    #[inline]
    pub fn get_init(&mut self, value: FilePoll) -> ptr::NonNull<FilePoll> {
        self.hive.get_init(value)
    }

    pub fn process_deferred_frees(&mut self) {
        let mut next = self.pending_free_head;
        while !next.is_null() {
            let current = next;
            // SAFETY: intrusive deferred-free list; nodes are valid HiveArray slots
            // until put(). Walk via raw-pointer reads/writes only — materializing a
            // `&mut FilePoll` here would alias the `&mut self.hive` borrow taken by
            // `put()` below (the slot may live inside the inline hive buffer). Zig's
            // `*FilePoll` freely aliases, so raw-ptr discipline is the faithful port.
            unsafe {
                next = (*current).next_to_free;
                (*current).next_to_free = ptr::null_mut();
                // FilePoll has no drop glue; `put` is a no-op drop + recycle.
                self.hive.put(current);
            }
        }
        self.pending_free_head = ptr::null_mut();
        self.pending_free_tail = ptr::null_mut();
    }

    /// `poll` is a live, fully-initialized slot in `self.hive`. Touched only
    /// through raw pointer ops to avoid forming a `&mut FilePoll` that would
    /// alias `&mut self` (the hive buffer is inline storage).
    pub fn put(&mut self, poll: ptr::NonNull<FilePoll>, vm: EventLoopCtx, ever_registered: bool) {
        let poll = poll.as_ptr();
        if !ever_registered {
            // SAFETY: `poll` is a fully-initialized hive slot; FilePoll has no
            // drop glue, so `put` is a no-op drop + recycle.
            unsafe { self.hive.put(poll) };
            return;
        }

        // SAFETY: `poll` is a valid HiveArray slot pointer. It may live inside
        // `self.hive.buffer`, so we access it via raw pointer only (no `&mut FilePoll`
        // materialized) to avoid aliasing `&mut self` — Zig's `*FilePoll` freely aliases.
        debug_assert!(unsafe { (*poll).next_to_free }.is_null());

        let tail = self.pending_free_tail;
        if !tail.is_null() {
            debug_assert!(!self.pending_free_head.is_null());
            // SAFETY: `tail` is a valid slot in the intrusive deferred-free list;
            // raw-ptr access avoids a second `&mut FilePoll` overlapping `poll`/`self`.
            debug_assert!(unsafe { (*tail).next_to_free }.is_null());
            unsafe { (*tail).next_to_free = poll };
        }

        if self.pending_free_head.is_null() {
            self.pending_free_head = poll;
            debug_assert!(self.pending_free_tail.is_null());
        }

        // SAFETY: see above — short-lived field borrow through raw `poll`, no overlap held.
        unsafe { (*poll).flags.insert(Flags::IgnoreUpdates) };
        self.pending_free_tail = poll;

        let callback: OpaqueCallback = Self::process_deferred_frees_thunk;
        debug_assert!(
            vm.after_event_loop_callback().is_none()
                || vm.after_event_loop_callback().map(|f| f as usize) == Some(callback as usize)
        );
        vm.set_after_event_loop_callback(
            Some(callback),
            core::ptr::NonNull::new(core::ptr::from_mut::<Store>(self).cast::<c_void>()),
        );
    }

    // Safe fn item: module-private thunk, only coerced to the C-ABI
    // `OpaqueCallback` fn-pointer type — never callable by name outside
    // `Store`. Body wraps its raw-ptr op explicitly.
    extern "C" fn process_deferred_frees_thunk(ctx: *mut c_void) {
        // SAFETY: `ctx` was set to `self as *mut Store` in `put` above. The thunk fires
        // from the event loop's after-tick hook with no other `&mut Store` borrow live,
        // so this is the unique accessor (safe-single-owner).
        let this = unsafe { bun_ptr::callback_ctx::<Store>(ctx) };
        this.process_deferred_frees();
    }
}

pub struct Waker {
    loop_: bun_ptr::BackRef<WindowsLoop>,
}
// SAFETY: `Waker::wake()` only forwards to `WindowsLoop::wakeup()`, which is
// the documented cross-thread wake path (uv_async_send under the hood).
unsafe impl Send for Waker {}
unsafe impl Sync for Waker {}

impl Waker {
    pub fn init() -> Result<Waker, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Waker {
            loop_: bun_ptr::BackRef::from(
                ptr::NonNull::new(WindowsLoop::get()).expect("WindowsLoop::get() singleton"),
            ),
        })
    }

    #[inline]
    pub fn uv_loop(&self) -> *mut uv::Loop {
        // `BackRef` deref is safe (pointee outlives holder); `uv_loop` is a
        // `Copy` field set once by `us_create_loop` and immutable for the
        // process.
        self.loop_.uv_loop
    }

    // TODO(port): Zig used @compileError here; on Windows these must never be linked.
    pub fn get_fd(&self) -> Fd {
        unreachable!("Waker.getFd is unsupported on Windows");
    }

    // TODO(port): Zig used @compileError here; on Windows these must never be linked.
    pub fn init_with_file_descriptor(_fd: Fd) -> Waker {
        unreachable!("Waker.initWithFileDescriptor is unsupported on Windows");
    }

    pub fn wait(&self) {
        // Do NOT go through `WindowsLoop::wait(&mut self)`: that would
        // materialize a `&mut WindowsLoop` over the process-global singleton
        // for the entire duration of `us_loop_run`/`uv_run`, and a concurrent
        // `wake()` from a worker thread would alias it (two live `&mut T` to
        // one allocation = UB under Stacked/Tree Borrows). The Zig spec uses
        // a bare `*WindowsLoop` with no exclusivity; mirror that by calling
        // the C entry point with the raw pointer directly.
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

// ported from: src/aio/windows_event_loop.zig
