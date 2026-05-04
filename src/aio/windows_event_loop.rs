use core::ffi::c_void;
use core::ptr;

use bun_collections::HiveArray;
use bun_core::Output;
use bun_jsc::{self as jsc, AbstractVM, EventLoop, VirtualMachine};
use bun_sys::Fd;
use bun_sys::windows::libuv as uv;
use bun_uws::WindowsLoop;

use crate::posix_event_loop as posix;

bun_output::declare_scope!(KeepAlive, visible);
bun_output::declare_scope!(FilePoll, visible);

pub type Loop = uv::Loop;

#[derive(Default)]
pub struct KeepAlive {
    status: Status,
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum Status {
    Active,
    #[default]
    Inactive,
    Done,
}

impl KeepAlive {
    #[inline]
    pub fn is_active(&self) -> bool {
        self.status == Status::Active
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable(&mut self) {
        if self.status == Status::Active {
            self.unref(VirtualMachine::get());
        }

        self.status = Status::Done;
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(&mut self, loop_: &mut Loop) {
        if self.status != Status::Active {
            return;
        }

        self.status = Status::Inactive;
        loop_.dec();
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(&mut self, loop_: &mut Loop) {
        if self.status != Status::Active {
            return;
        }

        self.status = Status::Active;
        loop_.inc();
    }

    pub fn init() -> KeepAlive {
        KeepAlive::default()
    }

    /// Prevent a poll from keeping the process alive.
    // TODO(port): Zig branches on `comptime @TypeOf == EventLoopHandle` vs AbstractVM wrap;
    // in Rust both impl AbstractVM so the branch collapses.
    pub fn unref(&mut self, event_loop_ctx: impl AbstractVM) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        event_loop_ctx.platform_event_loop().sub_active(1);
    }

    /// From another thread, Prevent a poll from keeping the process alive.
    pub fn unref_concurrently(&mut self, vm: &mut VirtualMachine) {
        // _ = vm;
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        vm.event_loop.unref_concurrently();
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick(&mut self, vm: &mut VirtualMachine) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        vm.event_loop_handle.as_mut().unwrap().dec();
    }

    /// From another thread, prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick_concurrently(&mut self, vm: &mut VirtualMachine) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        // TODO: https://github.com/oven-sh/bun/pull/4410#discussion_r1317326194
        vm.event_loop_handle.as_mut().unwrap().dec();
    }

    /// Allow a poll to keep the process alive.
    // TODO(port): Zig branches on `comptime @TypeOf == EventLoopHandle` vs AbstractVM wrap;
    // in Rust both impl AbstractVM so the branch collapses.
    pub fn ref_(&mut self, event_loop_ctx: impl AbstractVM) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
        event_loop_ctx.platform_event_loop().ref_();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_concurrently(&mut self, vm: &mut VirtualMachine) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
        vm.event_loop.ref_concurrently();
    }

    pub fn ref_concurrently_from_event_loop(&mut self, loop_: &mut EventLoop) {
        self.ref_concurrently(loop_.virtual_machine);
    }

    pub fn unref_concurrently_from_event_loop(&mut self, loop_: &mut EventLoop) {
        self.unref_concurrently(loop_.virtual_machine);
    }
}

pub type Flags = posix::file_poll::Flags;
pub type FlagsSet = posix::file_poll::FlagsSet;
pub type FlagsStruct = posix::file_poll::FlagsStruct;
pub type Owner = posix::file_poll::Owner;

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
    pub fn disable_keeping_process_alive(&mut self, abstract_vm: impl AbstractVM) {
        let vm = abstract_vm;
        if self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.insert(Flags::Closed);

        vm.platform_event_loop()
            .sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
        // vm.event_loop_handle.?.active_handles -= @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub fn init<T>(
        vm: &mut VirtualMachine,
        fd: Fd,
        flags: FlagsStruct,
        owner: &mut T,
    ) -> *mut FilePoll {
        Self::init_with_owner(vm, fd, flags, Owner::init(owner))
    }

    pub fn init_with_owner(
        vm: &mut VirtualMachine,
        fd: Fd,
        flags: FlagsStruct,
        owner: Owner,
    ) -> *mut FilePoll {
        let poll = vm.rare_data().file_polls(vm).get();
        // SAFETY: `get()` returns a valid uninitialized slot from the HiveArray pool.
        let poll = unsafe { &mut *poll };
        poll.fd = fd;
        poll.flags = FlagsSet::init(flags);
        poll.owner = owner;
        poll.next_to_free = ptr::null_mut();

        poll
    }

    // PORT NOTE: not `impl Drop` — FilePoll lives in a HiveArray pool slot, not a Box;
    // teardown returns the slot to the pool via `Store::put`.
    pub fn deinit(&mut self) {
        let vm = VirtualMachine::get();
        self.deinit_with_vm(vm);
    }

    #[inline]
    pub fn file_descriptor(&self) -> Fd {
        self.fd
    }

    pub fn deinit_force_unregister(&mut self) {
        self.deinit()
    }

    pub fn unregister(&mut self, _loop: &mut Loop) -> bool {
        // TODO(@paperclover): This cast is extremely suspicious. At best, `fd` is
        // the wrong type (it should be a uv handle), at worst this code is a
        // crash due to invalid memory access.
        // SAFETY: see TODO above — preserved verbatim from Zig.
        unsafe {
            // TODO(port): Zig does @ptrFromInt(@as(u64, @bitCast(this.fd))); Fd repr must be u64-bitcastable.
            let raw: u64 = core::mem::transmute_copy(&self.fd);
            uv::uv_unref(raw as *mut uv::uv_handle_t);
        }
        true
    }

    fn deinit_possibly_defer(
        &mut self,
        vm: &mut VirtualMachine,
        loop_: &mut Loop,
        polls: &mut Store,
    ) {
        if self.is_registered() {
            let _ = self.unregister(loop_);
        }

        let was_ever_registered = self.flags.contains(Flags::WasEverRegistered);
        self.flags = FlagsSet::default();
        self.fd = Fd::INVALID;
        polls.put(self, vm, was_ever_registered);
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

    pub fn deinit_with_vm(&mut self, vm: &mut VirtualMachine) {
        // PORT NOTE: reshaped for borrowck — capture both mut borrows from vm before call.
        // TODO(port): vm.rare_data().file_polls(vm) re-borrows vm; may need raw-ptr split.
        let loop_ = vm.event_loop_handle.as_mut().unwrap();
        let polls = vm.rare_data().file_polls(vm);
        self.deinit_possibly_defer(vm, loop_, polls);
    }

    pub fn enable_keeping_process_alive(&mut self, abstract_vm: impl AbstractVM) {
        let vm = abstract_vm;
        if !self.flags.contains(Flags::Closed) {
            return;
        }
        self.flags.remove(Flags::Closed);

        // vm.event_loop_handle.?.active_handles += @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
        vm.platform_event_loop()
            .add_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
    }

    pub fn can_activate(&self) -> bool {
        !self.flags.contains(Flags::HasIncrementedPollCount)
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(&mut self, loop_: &mut Loop) {
        debug_assert!(self.flags.contains(Flags::HasIncrementedPollCount));
        loop_.sub_active(self.flags.contains(Flags::HasIncrementedPollCount) as u32);
        bun_output::scoped_log!(FilePoll, "deactivate - {}", loop_.active_handles);
        self.flags.remove(Flags::HasIncrementedPollCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(&mut self, loop_: &mut Loop) {
        loop_.add_active(
            (!self.flags.contains(Flags::Closed)
                && !self.flags.contains(Flags::HasIncrementedPollCount)) as u32,
        );
        bun_output::scoped_log!(FilePoll, "activate - {}", loop_.active_handles);
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

    pub fn on_ended(&mut self, event_loop_ctx: impl AbstractVM) {
        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.insert(Flags::Closed);
        // this.deactivate(vm.event_loop_handle.?);
        self.deactivate(event_loop_ctx.platform_event_loop());
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, abstract_vm: impl AbstractVM) {
        let vm = abstract_vm;
        if !self.can_unref() {
            return;
        }
        bun_output::scoped_log!(FilePoll, "unref");
        // this.deactivate(vm.event_loop_handle.?);
        self.deactivate(vm.platform_event_loop());
    }

    /// Allow a poll to keep the process alive.
    // pub fn ref(this: *FilePoll, vm: *jsc.VirtualMachine) void {
    pub fn ref_(&mut self, event_loop_ctx: impl AbstractVM) {
        if self.can_ref() {
            return;
        }
        bun_output::scoped_log!(FilePoll, "ref");
        // this.activate(vm.event_loop_handle.?);
        self.activate(event_loop_ctx.platform_event_loop());
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

    pub fn get(&mut self) -> *mut FilePoll {
        self.hive.get()
    }

    pub fn process_deferred_frees(&mut self) {
        let mut next = self.pending_free_head;
        // SAFETY: intrusive deferred-free list; nodes are valid HiveArray slots until put().
        while let Some(current) = unsafe { next.as_mut() } {
            next = current.next_to_free;
            current.next_to_free = ptr::null_mut();
            self.hive.put(current);
        }
        self.pending_free_head = ptr::null_mut();
        self.pending_free_tail = ptr::null_mut();
    }

    pub fn put(&mut self, poll: *mut FilePoll, vm: &mut VirtualMachine, ever_registered: bool) {
        if !ever_registered {
            self.hive.put(poll);
            return;
        }

        // SAFETY: caller passes a valid HiveArray slot pointer.
        let poll_ref = unsafe { &mut *poll };
        debug_assert!(poll_ref.next_to_free.is_null());

        // SAFETY: tail is a valid slot in the intrusive deferred-free list.
        if let Some(tail) = unsafe { self.pending_free_tail.as_mut() } {
            debug_assert!(!self.pending_free_head.is_null());
            debug_assert!(tail.next_to_free.is_null());
            tail.next_to_free = poll;
        }

        if self.pending_free_head.is_null() {
            self.pending_free_head = poll;
            debug_assert!(self.pending_free_tail.is_null());
        }

        poll_ref.flags.insert(Flags::IgnoreUpdates);
        self.pending_free_tail = poll;

        // TODO(port): jsc.OpaqueWrap(Store, processDeferredFrees) — generate extern "C" thunk.
        let callback: jsc::OpaqueCallback = Self::process_deferred_frees_thunk;
        debug_assert!(
            vm.after_event_loop_callback.is_none()
                || vm.after_event_loop_callback == Some(callback)
        );
        vm.after_event_loop_callback = Some(callback);
        vm.after_event_loop_callback_ctx = self as *mut Store as *mut c_void;
    }

    extern "C" fn process_deferred_frees_thunk(ctx: *mut c_void) {
        // SAFETY: ctx was set to `self as *mut Store` in `put` above.
        let this = unsafe { &mut *(ctx as *mut Store) };
        this.process_deferred_frees();
    }
}

pub struct Waker {
    loop_: &'static WindowsLoop,
}

impl Waker {
    pub fn init() -> Result<Waker, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Waker {
            loop_: WindowsLoop::get(),
        })
    }

    // TODO(port): Zig used @compileError here; on Windows these must never be linked.
    #[allow(unused)]
    pub fn get_fd(&self) -> Fd {
        unreachable!("Waker.getFd is unsupported on Windows");
    }

    // TODO(port): Zig used @compileError here; on Windows these must never be linked.
    #[allow(unused)]
    pub fn init_with_file_descriptor(_fd: Fd) -> Waker {
        unreachable!("Waker.initWithFileDescriptor is unsupported on Windows");
    }

    pub fn wait(&self) {
        self.loop_.wait();
    }

    pub fn wake(&self) {
        self.loop_.wakeup();
    }
}

#[repr(C)]
pub struct Closer {
    io_request: uv::fs_t,
}

impl Closer {
    pub fn close(fd: Fd, loop_: *mut uv::Loop) {
        // SAFETY: all-zero is a valid uv::fs_t (libuv C struct, zero-initialized by convention).
        let io_request: uv::fs_t = unsafe { core::mem::zeroed() };
        let closer = Box::into_raw(Box::new(Closer { io_request }));
        // data is not overridden by libuv when calling uv_fs_close, its ok to set it here
        // SAFETY: closer is a freshly-boxed valid pointer.
        unsafe {
            (*closer).io_request.data = closer as *mut c_void;
            if let Some(err) =
                uv::uv_fs_close(loop_, &mut (*closer).io_request, fd.uv(), Some(Self::on_close))
                    .err_enum()
            {
                Output::debug_warn(format_args!("libuv close() failed = {}", err));
                drop(Box::from_raw(closer));
            }
        }
    }

    extern "C" fn on_close(req: *mut uv::fs_t) {
        // SAFETY: req points to Closer.io_request (set in `close` above).
        let closer: *mut Closer = unsafe {
            (req as *mut u8)
                .sub(core::mem::offset_of!(Closer, io_request))
                .cast::<Closer>()
        };
        // SAFETY: req.data was set to `closer` in `close`; both are valid for the callback's duration.
        unsafe {
            debug_assert!(closer == (*req).data.cast::<Closer>());
            bun_sys::syslog!(
                "uv_fs_close({}) = {}",
                Fd::from_uv((*req).file.fd),
                (*req).result
            );

            #[cfg(debug_assertions)]
            {
                if let Some(err) = (*closer).io_request.result.err_enum() {
                    Output::debug_warn(format_args!("libuv close() failed = {}", err));
                }
            }

            (*req).deinit();
            drop(Box::from_raw(closer));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/aio/windows_event_loop.zig (422 lines)
//   confidence: medium
//   todos:      8
//   notes:      AbstractVM trait collapses comptime EventLoopHandle branches; FilePoll pool-backed (no Drop); OpaqueWrap thunk hand-rolled; @compileError fns stubbed as unreachable!.
// ──────────────────────────────────────────────────────────────────────────
