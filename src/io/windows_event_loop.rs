use core::ffi::c_void;
use core::ptr;

use bun_sys::Fd;
use bun_sys::windows::libuv as uv;
use bun_uws_sys::WindowsLoop;

use crate::posix_event_loop as posix;
// Shared scaffolding lives in `posix_event_loop` (platform-agnostic types);
// only `FilePoll`/`Store`/`KeepAlive`/`Closer`/`Loop`/`Waker` are redefined
// here. `Flags`/`Owner`/etc. are re-aliased below from `posix` for callers
// that name them via this module.
pub use crate::posix_event_loop::{EventLoopCtx, OpaqueCallback, js_vm_ctx};

// `Loop` here is the raw
// `uv_loop_t`. (`WindowsLoop` is the uws wrapper that *owns* a `*mut uv::Loop`
// in its `.uv_loop` field; callers that hold a `WindowsLoop*` project that
// field themselves. See `VirtualMachine::event_loop_handle` /
// `SpawnSyncEventLoop` which store/compare the inner `uv::Loop` pointer.)
pub type Loop = uv::Loop;

// `KeepAlive` (struct + 14-method impl) was duplicated here and in
// `posix_event_loop.rs`; both copies now live in `crate::keep_alive`.

pub(crate) type Flags = posix::Flags;
pub type FlagsSet = posix::FlagsSet;
pub type Owner = posix::Owner;

pub struct FilePoll {
    pub(crate) fd: Fd,
    pub(crate) owner: Owner,
    pub(crate) flags: FlagsSet,
    pub(crate) next_to_free: *mut FilePoll,
}

impl FilePoll {
    #[inline]
    pub(crate) fn is_active(&self) -> bool {
        self.flags.contains(Flags::HasIncrementedPollCount)
    }

    #[inline]
    pub(crate) fn is_watching(&self) -> bool {
        !self.flags.contains(Flags::NeedsRearm)
            && (self.flags.contains(Flags::PollReadable)
                || self.flags.contains(Flags::PollWritable)
                || self.flags.contains(Flags::PollProcess))
    }

    pub(crate) fn is_registered(&self) -> bool {
        self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport)
    }

    /// Decrements the active counter if it was previously incremented.
    pub(crate) fn disable_keeping_process_alive(&mut self, vm: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.insert(Flags::Closed);

        vm.loop_sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
    }

    pub(crate) fn init(vm: EventLoopCtx, fd: Fd, flags: FlagsSet, owner: Owner) -> *mut FilePoll {
        Self::init_with_owner(vm, fd, flags, owner)
    }

    pub(crate) fn init_with_owner(
        vm: EventLoopCtx,
        fd: Fd,
        flags: FlagsSet,
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
    // teardown returns the slot to the pool via `Store::put`. As on POSIX, the
    // `deinit*` entry points take the slot pointer rather than `&mut self`
    // because `Store::put` frees the slot before it returns.

    /// Returns the slot to the event loop's `Store`.
    ///
    /// # Safety
    /// `this` is a live slot from [`FilePoll::init`] on this thread and is not used afterwards.
    pub unsafe fn deinit(this: *mut FilePoll) {
        // SAFETY: fn contract.
        unsafe { Self::deinit_with_vm(this, js_vm_ctx()) }
    }

    /// Safety: as for [`FilePoll::deinit`].
    pub(crate) unsafe fn deinit_force_unregister(this: *mut FilePoll) {
        // SAFETY: fn contract.
        unsafe { Self::deinit(this) }
    }

    pub(crate) fn unregister(&mut self, _loop: &mut WindowsLoop) -> bool {
        // TODO: This cast is extremely suspicious. At best, `fd` is
        // the wrong type (it should be a uv handle), at worst this code is a
        // crash due to invalid memory access.
        //
        // SAFETY: in practice this call is unreachable. On Windows nothing
        // ever sets the `Poll*` registration flags after construction (this
        // module defines no `register`), and every in-tree constructor passes
        // empty/default flags, so `is_registered()` stays false and
        // `clear_for_put` — the only path here — never takes the
        // `unregister` branch. If a Windows registration path is ever added,
        // this cast must be replaced with a real `uv_handle_t` pointer first
        // (see TODO above); `uv_unref` dereferences its argument.
        unsafe {
            uv::uv_unref(self.fd.0 as *mut uv::uv_handle_t);
        }
        true
    }

    /// Returns whether the poll was ever registered, which `Store::put` needs.
    fn clear_for_put(&mut self, loop_: &mut WindowsLoop) -> bool {
        if self.is_registered() {
            let _ = self.unregister(loop_);
        }

        let was_ever_registered = self.flags.contains(Flags::WasEverRegistered);
        self.flags = FlagsSet::default();
        self.fd = Fd::INVALID;
        was_ever_registered
    }

    /// Safety: as for [`FilePoll::deinit`]; `vm` is the context the poll was created on.
    pub(crate) unsafe fn deinit_with_vm(this: *mut FilePoll, vm: EventLoopCtx) {
        let loop_ = vm.loop_mut();
        // SAFETY: fn contract. The `&mut` the autoref forms ends with this
        // statement, so this path holds no reference into the slot when the
        // store takes it back.
        let was_ever_registered = unsafe { (*this).clear_for_put(loop_) };
        // SAFETY: `this` is non-null per fn contract.
        let slot = unsafe { ptr::NonNull::new_unchecked(this) };
        vm.file_polls_mut().put(slot, vm, was_ever_registered);
    }

    pub(crate) fn enable_keeping_process_alive(&mut self, vm: EventLoopCtx) {
        if !self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.remove(Flags::Closed);

        vm.loop_add_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
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
    pub(crate) fn get_init(&mut self, value: FilePoll) -> ptr::NonNull<FilePoll> {
        self.hive.get_init(value)
    }

    pub(crate) fn process_deferred_frees(&mut self) {
        let mut next = self.pending_free_head;
        while !next.is_null() {
            let current = next;
            // SAFETY: intrusive deferred-free list; nodes are valid HiveArray slots
            // until put(). Walk via raw-pointer reads/writes only — materializing a
            // `&mut FilePoll` here would alias the `&mut self.hive` borrow taken by
            // `put()` below (the slot may live inside the inline hive buffer).
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
        // materialized) to avoid aliasing `&mut self`.
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
