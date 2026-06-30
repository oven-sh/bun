use core::ffi::c_void;
use core::ptr;

use bun_sys::Fd;
use bun_uws_sys::WindowsLoop;

use crate::posix_event_loop as posix;
// Shared scaffolding lives in `posix_event_loop` (platform-agnostic types);
// only `FilePoll`/`Store`/`Loop` are redefined here. `Flags`/`Owner`/etc. are
// re-aliased below from `posix` for callers that name them via this module.
//
// Windows never registers polls (readers/writers/dns use engine sources), so
// `FilePoll` here is the minimal surface shared code binds: keep-alive
// counting + pool lifecycle. Event accessors and registration APIs are
// POSIX-only by design.
pub use crate::posix_event_loop::{
    AllocatorType, EventLoopCtx, OpaqueCallback, get_vm_ctx, js_vm_ctx,
};

bun_core::declare_scope!(KeepAlive, visible);
bun_core::declare_scope!(FilePoll, visible);

// Nominal identity with POSIX: `bun_io::Loop` IS the uws loop on every
// platform. Engine-handle consumers (pipes/tty/process/signal/fsevent) reach
// the bun_iocp loop via `bun_iocp::usockets::native_loop(ptr.cast())`.
pub type Loop = bun_uws_sys::Loop;

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
    pub fn is_registered(&self) -> bool {
        self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport)
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable_keeping_process_alive(&mut self, vm: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.insert(Flags::Closed);

        vm.loop_sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
    }

    pub fn init(
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

    /// Registration never happens on Windows (no `register()` here), so a
    /// poll is never "watching" — the shared `FilePollRef::is_watching`
    /// caller sees `false` and takes its re-arm path.
    pub fn is_watching(&self) -> bool {
        false
    }

    /// No registration exists to force-unregister; identical to `deinit`.
    pub fn deinit_force_unregister(&mut self) {
        self.deinit();
    }

    // Note: not `impl Drop` — FilePoll lives in a HiveArray pool slot, not a Box;
    // teardown returns the slot to the pool via `Store::put`.
    pub fn deinit(&mut self) {
        self.deinit_with_vm(js_vm_ctx());
    }

    fn deinit_possibly_defer(&mut self, vm: EventLoopCtx, _loop: &mut WindowsLoop) {
        // No register() exists on Windows — constructors pass empty flags and
        // nothing sets the Poll* registration bits, so there is never
        // anything to unregister. Keep the invariant loud.
        debug_assert!(!self.is_registered());

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

    /// Only intended to be used from EventLoop.Pollable
    // Note: the cycle-broken `EventLoopCtx::platform_event_loop` vtable is typed
    // `*mut bun_uws_sys::Loop` (the uws `WindowsLoop` wrapper) so the
    // impl-crate bodies (`VirtualMachine::uws_loop` / `MiniEventLoop::loop_ptr`)
    // type-check. `WindowsLoop::sub_active`/`add_active` proxy straight through
    // to the backend's active-handle count, so accept the wrapper here.
    pub fn deactivate(&mut self, loop_: &mut WindowsLoop) {
        debug_assert!(self.flags.contains(Flags::HasIncrementedPollCount));
        loop_.sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
        bun_core::scoped_log!(FilePoll, "deactivate - {}", loop_.active_count());
        self.flags.remove(Flags::HasIncrementedPollCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(&mut self, loop_: &mut WindowsLoop) {
        loop_.add_active(
            (!self.flags.contains(Flags::Closed)
                && !self.flags.contains(Flags::HasIncrementedPollCount)) as u32,
        );
        bun_core::scoped_log!(FilePoll, "activate - {}", loop_.active_count());
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
            // SAFETY: same contract as the read above — raw-ptr field write,
            // no `&mut FilePoll` materialized.
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

// `Waker` was duplicated here and in `crate::waker` (lib.rs); the canonical
// one is re-exported as `bun_io::Waker` (its `us_loop()` serves the
// BundleThread keep-alive). `Closer` likewise lives in `crate::closer`.
