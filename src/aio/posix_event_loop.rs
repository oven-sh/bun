use core::ffi::{c_int, c_void};
use core::fmt;
use core::ptr;

use bun_collections::{HiveArray, TaggedPtrUnion};
use bun_core::Output;
use bun_sys::{self as sys, Fd};
use bun_uws::Loop as UwsLoop;

// TODO(port): these cross-crate type paths are best-effort; Phase B wires the real module paths.
use bun_jsc::{self as jsc, AbstractVm, EventLoop, EventLoopHandle, MiniEventLoop, OpaqueCallback, VirtualMachine};
use bun_threading::{WorkPool, WorkPoolTask};

pub type Loop = UwsLoop;

bun_output::declare_scope!(KeepAlive, visible);

// ──────────────────────────────────────────────────────────────────────────
// KeepAlive
// ──────────────────────────────────────────────────────────────────────────

/// Track if an object whose file descriptor is being watched should keep the event loop alive.
/// This is not reference counted. It only tracks active or inactive.
#[derive(Default)]
pub struct KeepAlive {
    status: KeepAliveStatus,
}

#[derive(Default, Copy, Clone, PartialEq, Eq)]
enum KeepAliveStatus {
    Active,
    #[default]
    Inactive,
    Done,
}

impl KeepAlive {
    #[inline]
    pub fn is_active(&self) -> bool {
        self.status == KeepAliveStatus::Active
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable(&mut self) {
        self.unref(VirtualMachine::get());
        self.status = KeepAliveStatus::Done;
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(&mut self, loop_: &mut Loop) {
        if self.status != KeepAliveStatus::Active {
            return;
        }
        self.status = KeepAliveStatus::Inactive;
        loop_.sub_active(1);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(&mut self, loop_: &mut Loop) {
        if self.status != KeepAliveStatus::Inactive {
            return;
        }
        self.status = KeepAliveStatus::Active;
        loop_.add_active(1);
    }

    pub fn init() -> KeepAlive {
        KeepAlive::default()
    }

    /// Prevent a poll from keeping the process alive.
    // TODO(port): `anytype` event-loop context — Zig branches on @TypeOf for EventLoopHandle vs
    // AbstractVM. Phase B should expose a single `EventLoopCtx` trait covering both.
    pub fn unref(&mut self, event_loop_ctx: impl AbstractVm) {
        if self.status != KeepAliveStatus::Active {
            return;
        }
        self.status = KeepAliveStatus::Inactive;
        event_loop_ctx.platform_event_loop().unref();
    }

    /// From another thread, Prevent a poll from keeping the process alive.
    pub fn unref_concurrently(&mut self, vm: &mut VirtualMachine) {
        if self.status != KeepAliveStatus::Active {
            return;
        }
        self.status = KeepAliveStatus::Inactive;
        vm.event_loop.unref_concurrently();
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick(&mut self, event_loop_ctx: impl AbstractVm) {
        if self.status != KeepAliveStatus::Active {
            return;
        }
        self.status = KeepAliveStatus::Inactive;
        // vm.pending_unref_counter +|= 1;
        event_loop_ctx.increment_pending_unref_counter();
    }

    /// From another thread, prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick_concurrently(&mut self, vm: &mut VirtualMachine) {
        if self.status != KeepAliveStatus::Active {
            return;
        }
        self.status = KeepAliveStatus::Inactive;
        // TODO(port): vm.pending_unref_counter must be an Atomic; Zig uses @atomicRmw .Add .monotonic
        vm.pending_unref_counter
            .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    }

    /// Allow a poll to keep the process alive.
    // TODO(port): `anytype` event-loop context (see unref).
    pub fn ref_(&mut self, event_loop_ctx: impl AbstractVm) {
        if self.status != KeepAliveStatus::Inactive {
            return;
        }
        self.status = KeepAliveStatus::Active;
        event_loop_ctx.platform_event_loop().ref_();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_concurrently(&mut self, vm: &mut VirtualMachine) {
        if self.status != KeepAliveStatus::Inactive {
            return;
        }
        self.status = KeepAliveStatus::Active;
        vm.event_loop.ref_concurrently();
    }

    pub fn ref_concurrently_from_event_loop(&mut self, loop_: &mut EventLoop) {
        self.ref_concurrently(loop_.virtual_machine);
    }

    pub fn unref_concurrently_from_event_loop(&mut self, loop_: &mut EventLoop) {
        self.unref_concurrently(loop_.virtual_machine);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FilePoll
// ──────────────────────────────────────────────────────────────────────────

// `KQueueGenerationNumber` is `usize` on macOS-debug, else a zero-size sentinel.
#[cfg(all(target_os = "macos", debug_assertions))]
type KQueueGenerationNumber = usize;
#[cfg(not(all(target_os = "macos", debug_assertions)))]
type KQueueGenerationNumber = u8; // PORT NOTE: Zig uses `u0`; smallest Rust int is u8. Gated by cfg below.

#[cfg(all(target_os = "macos", debug_assertions))]
static mut MAX_GENERATION_NUMBER: KQueueGenerationNumber = 0;

/// Darwin uses the extended `kevent64_s` (extra `ext` field carries our
/// generation number); FreeBSD only has the plain `struct kevent`.
#[cfg(target_os = "macos")]
type KQueueEvent = bun_sys::darwin::kevent64_s;
#[cfg(target_os = "freebsd")]
type KQueueEvent = bun_sys::freebsd::Kevent;

/// Zig std's `.freebsd` `EV` struct omits EOF; the kernel value is the
/// same as Darwin/OpenBSD (sys/event.h: `#define EV_EOF 0x8000`).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const EV_EOF: u16 = 0x8000;

// PORT NOTE: Zig `kqueue_or_epoll` is a comptime string literal spliced via `++`; concat! only
// accepts literal tokens, so expose it as a macro that expands to the literal.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
macro_rules! kqueue_or_epoll { () => { "kevent" } }
#[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
macro_rules! kqueue_or_epoll { () => { "epoll" } }

// Owner type aliases — cross-crate references; Phase B wires real paths.
// TODO(port): verify each path against the crate map.
type ShellBufferedWriter = bun_shell::Interpreter::IOWriter::Poll;
type FileReader = bun_runtime::webcore::FileReader;
type Process = bun_spawn::Process;
type Subprocess = bun_jsc::Subprocess;
type StaticPipeWriter = <Subprocess as bun_jsc::SubprocessExt>::StaticPipeWriterPoll; // TODO(port): real path
type ShellStaticPipeWriter = bun_shell::ShellSubprocess::StaticPipeWriter::Poll;
type SecurityScanStaticPipeWriter = bun_install::SecurityScanSubprocess::StaticPipeWriter::Poll;
type FileSink = bun_runtime::webcore::FileSink::Poll;
type TerminalPoll = bun_runtime::api::Terminal::Poll;
type DNSResolver = bun_runtime::api::dns::Resolver;
type GetAddrInfoRequest = bun_runtime::api::dns::GetAddrInfoRequest;
type Request = bun_runtime::api::dns::internal::Request;
type LifecycleScriptSubprocessOutputReader = bun_install::LifecycleScriptSubprocess::OutputReader;
type BufferedReader = bun_io::BufferedReader;
type ParentDeathWatchdog = bun_core::ParentDeathWatchdog;

pub type Owner = TaggedPtrUnion<(
    FileSink,
    StaticPipeWriter,
    ShellStaticPipeWriter,
    SecurityScanStaticPipeWriter,
    BufferedReader,
    DNSResolver,
    GetAddrInfoRequest,
    Request,
    Process,
    ShellBufferedWriter, // i do not know why, but this has to be here otherwise compiler will complain about dependency loop
    TerminalPoll,
    ParentDeathWatchdog,
)>;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum AllocatorType {
    #[default]
    Js,
    Mini,
}

pub struct FilePoll {
    pub fd: Fd,
    pub flags: FlagsSet,
    pub owner: Owner,

    /// We re-use FilePoll objects to avoid allocating new ones.
    ///
    /// That means we might run into situations where the event is stale.
    /// on macOS kevent64 has an extra pointer field so we use it for that
    /// linux doesn't have a field like that
    pub generation_number: KQueueGenerationNumber,
    pub next_to_free: *mut FilePoll,

    pub allocator_type: AllocatorType,
}

impl Default for FilePoll {
    fn default() -> Self {
        Self {
            fd: INVALID_FD,
            flags: FlagsSet::empty(),
            owner: Owner::NULL,
            generation_number: 0,
            next_to_free: ptr::null_mut(),
            allocator_type: AllocatorType::Js,
        }
    }
}

impl FilePoll {
    fn update_flags(&mut self, updated: FlagsSet) {
        let mut flags = self.flags;
        flags.remove(Flags::Readable);
        flags.remove(Flags::Writable);
        flags.remove(Flags::Process);
        flags.remove(Flags::Machport);
        flags.remove(Flags::Eof);
        flags.remove(Flags::Hup);

        flags |= updated;
        self.flags = flags;
    }

    pub fn file_type(&self) -> bun_io::FileType {
        let flags = self.flags;
        if flags.contains(Flags::Socket) {
            return bun_io::FileType::Socket;
        }
        if flags.contains(Flags::Nonblocking) {
            return bun_io::FileType::NonblockingPipe;
        }
        bun_io::FileType::Pipe
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn on_kqueue_event(&mut self, _loop: &mut Loop, kqueue_event: &KQueueEvent) {
        self.update_flags(Flags::from_kqueue_event(kqueue_event));
        sys::syslog!("onKQueueEvent: {}", self);

        #[cfg(all(target_os = "macos", debug_assertions))]
        debug_assert!(self.generation_number == kqueue_event.ext[0] as usize);

        self.on_update(kqueue_event.data);
    }

    #[cfg(target_os = "linux")]
    pub fn on_epoll_event(&mut self, _loop: &mut Loop, epoll_event: &bun_sys::linux::epoll_event) {
        self.update_flags(Flags::from_epoll_event(epoll_event));
        self.on_update(0);
    }

    pub fn clear_event(&mut self, flag: Flags) {
        self.flags.remove(flag);
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

    pub fn is_writable(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Writable);
        self.flags.remove(Flags::Writable);
        readable
    }

    // PORT NOTE: not `impl Drop` — FilePoll is pool-allocated (HiveArray) and explicitly
    // put back via `Store::put`; Drop would be wrong here.
    pub fn deinit(&mut self) {
        match self.allocator_type {
            AllocatorType::Js => {
                let vm = VirtualMachine::get();
                let handle = jsc::abstract_vm(vm);
                let loop_ = handle.platform_event_loop();
                let file_polls = handle.file_polls();
                self.deinit_possibly_defer(vm, loop_, file_polls, false);
            }
            AllocatorType::Mini => {
                let vm = MiniEventLoop::global();
                let handle = jsc::abstract_vm(vm);
                let loop_ = handle.platform_event_loop();
                let file_polls = handle.file_polls();
                self.deinit_possibly_defer(vm, loop_, file_polls, false);
            }
        }
    }

    pub fn deinit_force_unregister(&mut self) {
        match self.allocator_type {
            AllocatorType::Js => {
                let vm = VirtualMachine::get();
                let loop_ = vm.event_loop_handle.unwrap();
                self.deinit_possibly_defer(vm, loop_, vm.rare_data().file_polls(vm), true);
            }
            AllocatorType::Mini => {
                let vm = MiniEventLoop::global();
                let loop_ = vm.loop_;
                self.deinit_possibly_defer(vm, loop_, vm.file_polls(), true);
            }
        }
    }

    fn deinit_possibly_defer(
        &mut self,
        vm: impl AbstractVm,
        loop_: &mut Loop,
        polls: &mut Store,
        force_unregister: bool,
    ) {
        let _ = self.unregister(loop_, force_unregister);

        self.owner.clear();
        let was_ever_registered = self.flags.contains(Flags::WasEverRegistered);
        self.flags = FlagsSet::empty();
        self.fd = INVALID_FD;
        polls.put(self, vm, was_ever_registered);
    }

    pub fn deinit_with_vm(&mut self, vm_: impl AbstractVm) {
        let vm = jsc::abstract_vm(&vm_);
        let loop_ = vm.platform_event_loop();
        self.deinit_possibly_defer(vm_, loop_, vm.file_polls(), false);
    }

    pub fn is_registered(&self) -> bool {
        self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport)
    }

    pub fn on_update(&mut self, size_or_offset: i64) {
        if self.flags.contains(Flags::OneShot) && !self.flags.contains(Flags::NeedsRearm) {
            self.flags.insert(Flags::NeedsRearm);
        }

        let ptr = self.owner;
        debug_assert!(!ptr.is_null());

        // TODO(port): TaggedPtrUnion tag dispatch — Phase B should generate this match via the
        // union's type list. Here we hand-expand the Zig `switch (ptr.tag())`.
        match ptr.tag() {
            t if t == Owner::tag_of::<ShellBufferedWriter>() => {
                let handler: &mut ShellBufferedWriter = ptr.as_mut::<ShellBufferedWriter>();
                handler.on_poll(size_or_offset, self.flags.contains(Flags::Hup));
            }
            t if t == Owner::tag_of::<ShellStaticPipeWriter>() => {
                let handler: &mut ShellStaticPipeWriter = ptr.as_mut::<ShellStaticPipeWriter>();
                handler.on_poll(size_or_offset, self.flags.contains(Flags::Hup));
            }
            t if t == Owner::tag_of::<StaticPipeWriter>() => {
                let handler: &mut StaticPipeWriter = ptr.as_mut::<StaticPipeWriter>();
                handler.on_poll(size_or_offset, self.flags.contains(Flags::Hup));
            }
            t if t == Owner::tag_of::<SecurityScanStaticPipeWriter>() => {
                let handler: &mut SecurityScanStaticPipeWriter =
                    ptr.as_mut::<SecurityScanStaticPipeWriter>();
                handler.on_poll(size_or_offset, self.flags.contains(Flags::Hup));
            }
            t if t == Owner::tag_of::<FileSink>() => {
                let handler: &mut FileSink = ptr.as_mut::<FileSink>();
                handler.on_poll(size_or_offset, self.flags.contains(Flags::Hup));
            }
            t if t == Owner::tag_of::<BufferedReader>() => {
                sys::syslog!(
                    concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) Reader"),
                    self.fd
                );
                let handler: &mut BufferedReader = ptr.as_mut::<BufferedReader>();
                handler.on_poll(size_or_offset, self.flags.contains(Flags::Hup));
            }
            t if t == Owner::tag_of::<Process>() => {
                sys::syslog!(
                    concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) Process"),
                    self.fd
                );
                let loader = ptr.as_mut::<Process>();
                loader.on_wait_pid_from_event_loop_task();
            }
            t if t == Owner::tag_of::<DNSResolver>() => {
                sys::syslog!(
                    concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) DNSResolver"),
                    self.fd
                );
                let loader: &mut DNSResolver = ptr.as_mut::<DNSResolver>();
                loader.on_dns_poll(self);
            }
            t if t == Owner::tag_of::<GetAddrInfoRequest>() => {
                #[cfg(not(target_os = "macos"))]
                unreachable!();
                #[cfg(target_os = "macos")]
                {
                    sys::syslog!(
                        concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) GetAddrInfoRequest"),
                        self.fd
                    );
                    let loader: &mut GetAddrInfoRequest = ptr.as_mut::<GetAddrInfoRequest>();
                    loader.on_machport_change();
                }
            }
            t if t == Owner::tag_of::<Request>() => {
                #[cfg(not(target_os = "macos"))]
                unreachable!();
                #[cfg(target_os = "macos")]
                {
                    sys::syslog!(
                        concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) InternalDNSRequest"),
                        self.fd
                    );
                    let loader: &mut Request = ptr.as_mut::<Request>();
                    Request::MacAsyncDNS::on_machport_change(loader);
                }
            }
            t if t == Owner::tag_of::<TerminalPoll>() => {
                sys::syslog!(
                    concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) Terminal"),
                    self.fd
                );
                let handler: &mut TerminalPoll = ptr.as_mut::<TerminalPoll>();
                handler.on_poll(size_or_offset, self.flags.contains(Flags::Hup));
            }
            t if t == Owner::tag_of::<ParentDeathWatchdog>() => {
                #[cfg(not(target_os = "macos"))]
                unreachable!();
                #[cfg(target_os = "macos")]
                {
                    sys::syslog!(
                        concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) ParentDeathWatchdog"),
                        self.fd
                    );
                    ptr.as_mut::<ParentDeathWatchdog>().on_parent_exit();
                }
            }
            _ => {
                let possible_name = Owner::type_name_from_tag(ptr.tag() as u16);
                sys::syslog!(
                    concat!("onUpdate ", kqueue_or_epoll!(), " (fd: {}) disconnected? (maybe: {})"),
                    self.fd,
                    bstr::BStr::new(possible_name.unwrap_or(b"<unknown>"))
                );
            }
        }
    }

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

    /// This decrements the active counter if it was previously incremented
    /// "active" controls whether or not the event loop should potentially idle
    // TODO(port): Zig dispatches on @TypeOf(event_loop_ctx_) for *EventLoop vs EventLoopHandle vs
    // AbstractVM. Phase B: collapse to a single EventLoopCtx trait method `loop_()`.
    pub fn disable_keeping_process_alive(&mut self, event_loop_ctx: impl AbstractVm) {
        event_loop_ctx
            .platform_event_loop()
            .sub_active(self.flags.contains(Flags::HasIncrementedActiveCount) as u32);

        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.remove(Flags::HasIncrementedActiveCount);
    }

    #[inline]
    pub fn can_enable_keeping_process_alive(&self) -> bool {
        self.flags.contains(Flags::KeepsEventLoopAlive)
            && self.flags.contains(Flags::HasIncrementedPollCount)
    }

    pub fn set_keeping_process_alive(&mut self, event_loop_ctx: impl AbstractVm, value: bool) {
        if value {
            self.enable_keeping_process_alive(event_loop_ctx);
        } else {
            self.disable_keeping_process_alive(event_loop_ctx);
        }
    }

    // TODO(port): see disable_keeping_process_alive note re: anytype dispatch.
    pub fn enable_keeping_process_alive(&mut self, event_loop_ctx: impl AbstractVm) {
        if self.flags.contains(Flags::Closed) {
            return;
        }

        event_loop_ctx
            .platform_event_loop()
            .add_active((!self.flags.contains(Flags::HasIncrementedActiveCount)) as u32);

        self.flags.insert(Flags::KeepsEventLoopAlive);
        self.flags.insert(Flags::HasIncrementedActiveCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    fn deactivate(&mut self, loop_: &mut Loop) {
        if self.flags.contains(Flags::HasIncrementedPollCount) {
            loop_.dec();
        }
        self.flags.remove(Flags::HasIncrementedPollCount);

        loop_.sub_active(self.flags.contains(Flags::HasIncrementedActiveCount) as u32);
        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.remove(Flags::HasIncrementedActiveCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    fn activate(&mut self, loop_: &mut Loop) {
        self.flags.remove(Flags::Closed);

        if !self.flags.contains(Flags::HasIncrementedPollCount) {
            loop_.inc();
        }
        self.flags.insert(Flags::HasIncrementedPollCount);

        if self.flags.contains(Flags::KeepsEventLoopAlive) {
            loop_.add_active((!self.flags.contains(Flags::HasIncrementedActiveCount)) as u32);
            self.flags.insert(Flags::HasIncrementedActiveCount);
        }
    }

    // TODO(port): Zig branches on @TypeOf(vm) for *PackageManager, EventLoopHandle, else.
    // Phase B: callers normalize to EventLoopHandle before calling.
    pub fn init<T>(vm: EventLoopHandle, fd: Fd, flags: FlagsSet, owner: &mut T) -> *mut FilePoll
    where
        Owner: From<*mut T>,
    {
        let poll = vm.file_polls().get();
        // SAFETY: Store::get returns a valid uninitialized slot from the hive.
        let poll = unsafe { &mut *poll };
        poll.fd = fd;
        poll.flags = flags;
        poll.owner = Owner::init(owner);
        poll.next_to_free = ptr::null_mut();
        poll.allocator_type = if vm.is_js() {
            AllocatorType::Js
        } else {
            AllocatorType::Mini
        };

        #[cfg(all(target_os = "macos", debug_assertions))]
        {
            // SAFETY: single-threaded event loop; matches Zig `max_generation_number +%= 1`.
            unsafe {
                MAX_GENERATION_NUMBER = MAX_GENERATION_NUMBER.wrapping_add(1);
                poll.generation_number = MAX_GENERATION_NUMBER;
            }
        }
        sys::syslog!(
            "FilePoll.init(0x{:x}, generation_number={}, fd={})",
            poll as *mut _ as usize,
            poll.generation_number,
            fd
        );
        poll
    }

    pub fn init_with_owner(vm: impl AbstractVm, fd: Fd, flags: FlagsSet, owner: Owner) -> *mut FilePoll {
        let poll = vm.alloc_file_poll();
        // SAFETY: alloc_file_poll returns a valid pool slot.
        let poll_ref = unsafe { &mut *poll };
        poll_ref.fd = fd;
        poll_ref.flags = flags;
        poll_ref.owner = owner;
        poll_ref.next_to_free = ptr::null_mut();
        // TODO(port): Zig sets `.js` iff @TypeOf(vm_) == *VirtualMachine; needs trait method.
        poll_ref.allocator_type = if vm.is_js_vm() {
            AllocatorType::Js
        } else {
            AllocatorType::Mini
        };

        #[cfg(all(target_os = "macos", debug_assertions))]
        {
            // SAFETY: single-threaded event loop.
            unsafe {
                MAX_GENERATION_NUMBER = MAX_GENERATION_NUMBER.wrapping_add(1);
                poll_ref.generation_number = MAX_GENERATION_NUMBER;
            }
        }

        sys::syslog!(
            "FilePoll.initWithOwner(0x{:x}, generation_number={}, fd={})",
            poll as usize,
            poll_ref.generation_number,
            fd
        );
        poll
    }

    #[inline]
    pub fn can_ref(&self) -> bool {
        // TODO(port): Zig checks `.disable` flag, but no such variant exists in Flags enum —
        // dead code in Zig? Preserving as no-op false check.
        !self.flags.contains(Flags::HasIncrementedPollCount)
    }

    #[inline]
    pub fn can_unref(&self) -> bool {
        self.flags.contains(Flags::HasIncrementedPollCount)
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, event_loop_ctx: impl AbstractVm) {
        sys::syslog!("unref");
        self.disable_keeping_process_alive(event_loop_ctx);
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&mut self, event_loop_ctx: impl AbstractVm) {
        if self.flags.contains(Flags::Closed) {
            return;
        }
        sys::syslog!("ref");
        self.enable_keeping_process_alive(event_loop_ctx);
    }

    pub fn on_ended(&mut self, event_loop_ctx: impl AbstractVm) {
        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.insert(Flags::Closed);
        self.deactivate(event_loop_ctx.platform_event_loop());
    }

    #[inline]
    pub fn file_descriptor(&self) -> Fd {
        self.fd
    }

    pub fn register(&mut self, loop_: &mut Loop, flag: Flags, one_shot: bool) -> sys::Result<()> {
        self.register_with_fd(
            loop_,
            flag,
            if one_shot { OneShotFlag::OneShot } else { OneShotFlag::None },
            self.fd,
        )
    }

    pub fn register_with_fd(
        &mut self,
        loop_: &mut Loop,
        flag: Flags,
        one_shot: OneShotFlag,
        fd: Fd,
    ) -> sys::Result<()> {
        let watcher_fd = loop_.fd;

        sys::syslog!(
            "register: FilePoll(0x{:x}, generation_number={}) {} ({})",
            self as *mut _ as usize,
            self.generation_number,
            <&'static str>::from(flag),
            fd
        );

        debug_assert!(fd != INVALID_FD);

        if one_shot != OneShotFlag::None {
            self.flags.insert(Flags::OneShot);
        }

        #[cfg(target_os = "linux")]
        {
            use bun_sys::linux::{self, EPOLL};
            let one_shot_flag: u32 = if !self.flags.contains(Flags::OneShot) {
                0
            } else {
                EPOLL::ONESHOT
            };

            let mut flags: u32 = match flag {
                Flags::Process | Flags::Readable => EPOLL::IN | EPOLL::HUP | one_shot_flag,
                Flags::Writable => EPOLL::OUT | EPOLL::HUP | EPOLL::ERR | one_shot_flag,
                _ => unreachable!(),
            };
            // epoll keys on fd alone; if the other direction is already
            // registered on this poll, preserve it in the CTL_MOD mask.
            // (EPOLLONESHOT disarms the whole fd after the first event in
            // either direction, so bidirectional one-shot is not supported.)
            if flag == Flags::Readable && self.flags.contains(Flags::PollWritable) {
                debug_assert!(!self.flags.contains(Flags::OneShot));
                flags |= EPOLL::OUT | EPOLL::ERR;
            }
            if flag == Flags::Writable && self.flags.contains(Flags::PollReadable) {
                debug_assert!(!self.flags.contains(Flags::OneShot));
                flags |= EPOLL::IN;
            }

            let mut event = linux::epoll_event {
                events: flags,
                data: linux::epoll_data {
                    u64_: Pollable::init(self).ptr() as u64,
                },
            };

            let op: u32 = if self.is_registered() || self.flags.contains(Flags::NeedsRearm) {
                EPOLL::CTL_MOD
            } else {
                EPOLL::CTL_ADD
            };

            let ctl = linux::epoll_ctl(watcher_fd, op, fd.cast(), &mut event);
            self.flags.insert(Flags::WasEverRegistered);
            if let Some(errno) = sys::Result::<()>::errno_sys(ctl, sys::Tag::epoll_ctl) {
                self.deactivate(loop_);
                return errno;
            }
        }
        #[cfg(target_os = "macos")]
        {
            use bun_sys::darwin::{kevent64_s, EV, EVFILT, NOTE};
            // SAFETY: all-zero is a valid kevent64_s
            let mut changelist: [kevent64_s; 2] = unsafe { core::mem::zeroed() };
            let one_shot_flag: u16 = if !self.flags.contains(Flags::OneShot) {
                0
            } else if one_shot == OneShotFlag::Dispatch {
                EV::DISPATCH | EV::ENABLE
            } else {
                EV::ONESHOT
            };

            changelist[0] = match flag {
                Flags::Readable => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::READ,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                Flags::Writable => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                Flags::Process => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::PROC,
                    data: 0,
                    fflags: NOTE::EXIT,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                Flags::Machport => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::MACHPORT,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                _ => unreachable!(),
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS: u32 = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            let rc = 'rc: loop {
                // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
                let rc = unsafe {
                    bun_sys::darwin::kevent64(
                        watcher_fd,
                        changelist.as_ptr(),
                        1,
                        // The same array may be used for the changelist and eventlist.
                        changelist.as_mut_ptr(),
                        // we set 0 here so that if we get an error on
                        // registration, it becomes errno
                        0,
                        KEVENT_FLAG_ERROR_EVENTS,
                        &TIMEOUT,
                    )
                };
                if sys::get_errno(rc) == sys::E::INTR {
                    continue;
                }
                break 'rc rc;
            };

            self.flags.insert(Flags::WasEverRegistered);

            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data. xnu ORs
            // EV_ERROR into the existing action bits, so test the bit.
            if (changelist[0].flags & EV::ERROR) != 0 && changelist[0].data != 0 {
                return sys::Result::<()>::errno_sys(changelist[0].data, sys::Tag::kevent).unwrap();
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            let errno = sys::get_errno(rc);
            if errno != sys::E::SUCCESS {
                self.deactivate(loop_);
                return sys::Result::Err(sys::Error::from_code(errno, sys::Tag::kqueue));
            }
        }
        #[cfg(target_os = "freebsd")]
        {
            use bun_sys::freebsd::{kevent, Kevent, EV, EVFILT, NOTE};
            // SAFETY: all-zero is a valid Kevent
            let mut changelist: [Kevent; 1] = unsafe { core::mem::zeroed() };
            let one_shot_flag: u16 = if !self.flags.contains(Flags::OneShot) {
                0
            } else if one_shot == OneShotFlag::Dispatch {
                EV::DISPATCH | EV::ENABLE
            } else {
                EV::ONESHOT
            };

            changelist[0] = match flag {
                Flags::Readable => Kevent {
                    ident: usize::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::READ,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as usize,
                    flags: EV::ADD | one_shot_flag,
                },
                Flags::Writable => Kevent {
                    ident: usize::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as usize,
                    flags: EV::ADD | one_shot_flag,
                },
                Flags::Process => Kevent {
                    ident: usize::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::PROC,
                    data: 0,
                    fflags: NOTE::EXIT,
                    udata: Pollable::init(self).ptr() as usize,
                    flags: EV::ADD | one_shot_flag,
                },
                Flags::Machport => {
                    return sys::Result::Err(sys::Error {
                        errno: sys::E::OPNOTSUPP as i32,
                        syscall: sys::Tag::kevent,
                        ..Default::default()
                    })
                }
                _ => unreachable!(),
            };

            let rc = 'rc: loop {
                // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
                let rc = unsafe {
                    kevent(
                        watcher_fd,
                        changelist.as_ptr(),
                        1,
                        // Same array for changelist and eventlist; nevents=0 so
                        // registration errors come back via errno.
                        changelist.as_mut_ptr(),
                        0,
                        ptr::null(),
                    )
                };
                if sys::get_errno(rc) == sys::E::INTR {
                    continue;
                }
                break 'rc rc;
            };

            self.flags.insert(Flags::WasEverRegistered);
            if let Some(err) = sys::Result::<()>::errno_sys(rc, sys::Tag::kevent) {
                self.deactivate(loop_);
                return err;
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "freebsd")))]
        {
            compile_error!("unsupported platform");
        }

        self.activate(loop_);
        self.flags.insert(match flag {
            Flags::Readable => Flags::PollReadable,
            Flags::Process => {
                #[cfg(target_os = "linux")]
                {
                    Flags::PollReadable
                }
                #[cfg(not(target_os = "linux"))]
                {
                    Flags::PollProcess
                }
            }
            Flags::Writable => Flags::PollWritable,
            Flags::Machport => Flags::PollMachport,
            _ => unreachable!(),
        });
        self.flags.remove(Flags::NeedsRearm);

        sys::Result::Ok(())
    }

    pub fn unregister(&mut self, loop_: &mut Loop, force_unregister: bool) -> sys::Result<()> {
        self.unregister_with_fd(loop_, self.fd, force_unregister)
    }

    pub fn unregister_with_fd(
        &mut self,
        loop_: &mut Loop,
        fd: Fd,
        force_unregister: bool,
    ) -> sys::Result<()> {
        // PORT NOTE: reshaped for borrowck (Zig `defer this.deactivate(loop)`) — compute the
        // syscall result first, then unconditionally deactivate. Avoids the raw-pointer scopeguard
        // the literal translation would require.
        let result = self.unregister_with_fd_impl(loop_, fd, force_unregister);
        self.deactivate(loop_);
        result
    }

    fn unregister_with_fd_impl(
        &mut self,
        loop_: &mut Loop,
        fd: Fd,
        force_unregister: bool,
    ) -> sys::Result<()> {
        #[cfg(debug_assertions)]
        debug_assert!(fd.native() >= 0 && fd != INVALID_FD);

        if !(self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport))
        {
            // no-op
            return sys::Result::Ok(());
        }

        debug_assert!(fd != INVALID_FD);
        let watcher_fd = loop_.fd;
        let both_directions =
            self.flags.contains(Flags::PollReadable) && self.flags.contains(Flags::PollWritable);
        let flag: Flags = 'brk: {
            if self.flags.contains(Flags::PollReadable) {
                break 'brk Flags::Readable;
            }
            if self.flags.contains(Flags::PollWritable) {
                break 'brk Flags::Writable;
            }
            if self.flags.contains(Flags::PollProcess) {
                break 'brk Flags::Process;
            }
            if self.flags.contains(Flags::PollMachport) {
                break 'brk Flags::Machport;
            }
            return sys::Result::Ok(());
        };

        if self.flags.contains(Flags::NeedsRearm) && !force_unregister {
            sys::syslog!(
                "unregister: {} ({}) skipped due to needs_rearm",
                <&'static str>::from(flag),
                fd
            );
            self.flags.remove(Flags::PollProcess);
            self.flags.remove(Flags::PollReadable);
            self.flags.remove(Flags::PollWritable);
            self.flags.remove(Flags::PollMachport);
            return sys::Result::Ok(());
        }

        sys::syslog!(
            "unregister: FilePoll(0x{:x}, generation_number={}) {}{} ({})",
            self as *mut _ as usize,
            self.generation_number,
            <&'static str>::from(flag),
            if both_directions { "+writable" } else { "" },
            fd
        );

        #[cfg(target_os = "linux")]
        {
            use bun_sys::linux::{self, EPOLL};
            // CTL_DEL keys on fd alone, so both directions are removed together.
            let ctl = linux::epoll_ctl(watcher_fd, EPOLL::CTL_DEL, fd.cast(), ptr::null_mut());

            if let Some(errno) = sys::Result::<()>::errno_sys(ctl, sys::Tag::epoll_ctl) {
                return errno;
            }
        }
        #[cfg(target_os = "macos")]
        {
            use bun_sys::darwin::{kevent64, kevent64_s, EV, EVFILT, NOTE};
            // SAFETY: all-zero is a valid kevent64_s
            let mut changelist: [kevent64_s; 2] = unsafe { core::mem::zeroed() };

            changelist[0] = match flag {
                Flags::Readable => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::READ,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                Flags::Machport => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::MACHPORT,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                Flags::Writable => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                Flags::Process => kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::PROC,
                    data: 0,
                    fflags: NOTE::EXIT,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                _ => unreachable!(),
            };

            let mut nchanges: c_int = 1;
            if both_directions {
                // kqueue keys on (fd, filter); delete EVFILT_WRITE as a second change.
                changelist[1] = kevent64_s {
                    ident: u64::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                };
                nchanges = 2;
            }

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS: u32 = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
            let rc = unsafe {
                kevent64(
                    watcher_fd,
                    changelist.as_ptr(),
                    nchanges,
                    // The same array may be used for the changelist and eventlist.
                    changelist.as_mut_ptr(),
                    nchanges,
                    KEVENT_FLAG_ERROR_EVENTS,
                    &TIMEOUT,
                )
            };

            let errno = sys::get_errno(rc);
            // Global failure (e.g. EBADF on the kqueue fd): the eventlist
            // was not written, so per-entry checks below would read our
            // own input. Report errno and stop.
            if rc < 0 {
                return sys::Result::<()>::errno_sys(errno as i64, sys::Tag::kevent).unwrap();
            }

            // If an error occurs while processing an element of the changelist
            // and there is enough room in the eventlist, then the event will be
            // placed in the eventlist with EV_ERROR set in flags and the system
            // error in data. With KEVENT_FLAG_ERROR_EVENTS, rc is the count of
            // such error events; they are packed from index 0 regardless of
            // which change failed. xnu ORs EV_ERROR into the existing action
            // bits (EV_DELETE|EV_ERROR = 0x4002), so test the bit, not equality.
            if rc >= 1 && (changelist[0].flags & EV::ERROR) != 0 && changelist[0].data != 0 {
                return sys::Result::<()>::errno_sys(changelist[0].data, sys::Tag::kevent).unwrap();
            }
            if rc >= 2 && (changelist[1].flags & EV::ERROR) != 0 && changelist[1].data != 0 {
                return sys::Result::<()>::errno_sys(changelist[1].data, sys::Tag::kevent).unwrap();
            }
        }
        #[cfg(target_os = "freebsd")]
        {
            use bun_sys::freebsd::{kevent, Kevent, EV, EVFILT, NOTE};
            // SAFETY: all-zero is a valid Kevent
            let mut changelist: [Kevent; 2] = unsafe { core::mem::zeroed() };
            changelist[0] = match flag {
                Flags::Readable => Kevent {
                    ident: usize::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::READ,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as usize,
                    flags: EV::DELETE,
                },
                Flags::Writable => Kevent {
                    ident: usize::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as usize,
                    flags: EV::DELETE,
                },
                Flags::Process => Kevent {
                    ident: usize::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::PROC,
                    data: 0,
                    fflags: NOTE::EXIT,
                    udata: Pollable::init(self).ptr() as usize,
                    flags: EV::DELETE,
                },
                Flags::Machport => {
                    return sys::Result::Err(sys::Error {
                        errno: sys::E::OPNOTSUPP as i32,
                        syscall: sys::Tag::kevent,
                        ..Default::default()
                    });
                }
                _ => unreachable!(),
            };

            let mut nchanges: c_int = 1;
            if both_directions {
                changelist[1] = Kevent {
                    ident: usize::try_from(fd.cast()).unwrap(),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as usize,
                    flags: EV::DELETE,
                };
                nchanges = 2;
            }

            // nevents=0: per-entry errors surface as rc=-1/errno for the
            // first failing change. For EV_DELETE (typically ENOENT) a silent
            // miss on the second entry is harmless.
            // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
            let rc = unsafe {
                kevent(
                    watcher_fd,
                    changelist.as_ptr(),
                    nchanges,
                    changelist.as_mut_ptr(),
                    0,
                    ptr::null(),
                )
            };
            if let Some(err) = sys::Result::<()>::errno_sys(rc, sys::Tag::kevent) {
                return err;
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "freebsd")))]
        {
            compile_error!("unsupported platform");
        }

        self.flags.remove(Flags::NeedsRearm);
        self.flags.remove(Flags::OneShot);
        self.flags.remove(Flags::PollReadable);
        self.flags.remove(Flags::PollWritable);
        self.flags.remove(Flags::PollProcess);
        self.flags.remove(Flags::PollMachport);

        sys::Result::Ok(())
    }
}

impl fmt::Display for FilePoll {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "FilePoll(fd={}, generation_number={}) = {}",
            self.fd,
            self.generation_number,
            FlagsFormatter(self.flags)
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Flags
// ──────────────────────────────────────────────────────────────────────────

#[derive(enumset::EnumSetType, strum::IntoStaticStr, Debug)]
#[strum(serialize_all = "snake_case")]
pub enum Flags {
    // What are we asking the event loop about?
    /// Poll for readable events
    PollReadable,
    /// Poll for writable events
    PollWritable,
    /// Poll for process-related events
    PollProcess,
    /// Poll for machport events
    PollMachport,

    // What did the event loop tell us?
    Readable,
    Writable,
    Process,
    Eof,
    Hup,
    Machport,

    // What is the type of file descriptor?
    Fifo,
    Tty,

    OneShot,
    NeedsRearm,

    HasIncrementedPollCount,
    HasIncrementedActiveCount,
    Closed,

    KeepsEventLoopAlive,

    Nonblocking,

    WasEverRegistered,
    IgnoreUpdates,

    /// Was O_NONBLOCK set on the file descriptor?
    Nonblock,

    Socket,
}

pub type FlagsSet = enumset::EnumSet<Flags>;
// TODO(port): Zig `Flags.Struct = std.enums.EnumFieldStruct(Flags, bool, false)` — used as a
// builder for Set.init(). In Rust, callers should construct `FlagsSet` directly via `|`.
pub type FlagsStruct = FlagsSet;

impl Flags {
    pub fn poll(self) -> Flags {
        match self {
            Flags::Readable => Flags::PollReadable,
            Flags::Writable => Flags::PollWritable,
            Flags::Process => Flags::PollProcess,
            Flags::Machport => Flags::PollMachport,
            other => other,
        }
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn from_kqueue_event(kqueue_event: &KQueueEvent) -> FlagsSet {
        use bun_sys::darwin::EVFILT; // TODO(port): freebsd EVFILT path
        let mut flags = FlagsSet::empty();
        if kqueue_event.filter == EVFILT::READ {
            flags.insert(Flags::Readable);
            if kqueue_event.flags & EV_EOF != 0 {
                flags.insert(Flags::Hup);
            }
        } else if kqueue_event.filter == EVFILT::WRITE {
            flags.insert(Flags::Writable);
            if kqueue_event.flags & EV_EOF != 0 {
                flags.insert(Flags::Hup);
            }
        } else if kqueue_event.filter == EVFILT::PROC {
            flags.insert(Flags::Process);
        } else {
            #[cfg(target_os = "macos")]
            if kqueue_event.filter == EVFILT::MACHPORT {
                flags.insert(Flags::Machport);
            }
        }
        flags
    }

    #[cfg(target_os = "linux")]
    pub fn from_epoll_event(epoll: &bun_sys::linux::epoll_event) -> FlagsSet {
        use bun_sys::linux::EPOLL;
        let mut flags = FlagsSet::empty();
        if epoll.events & EPOLL::IN != 0 {
            flags.insert(Flags::Readable);
        }
        if epoll.events & EPOLL::OUT != 0 {
            flags.insert(Flags::Writable);
        }
        if epoll.events & EPOLL::ERR != 0 {
            flags.insert(Flags::Eof);
        }
        if epoll.events & EPOLL::HUP != 0 {
            flags.insert(Flags::Hup);
        }
        flags
    }
}

pub struct FlagsFormatter(pub FlagsSet);

impl fmt::Display for FlagsFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut is_first = true;
        for flag in self.0.iter() {
            if !is_first {
                write!(f, " | ")?;
            }
            f.write_str(<&'static str>::from(flag))?;
            is_first = false;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): Zig uses `if (bun.heap_breakdown.enabled) 0 else 128` for the hive size.
const HIVE_SIZE: usize = 128;
type FilePollHive = bun_collections::hive_array::Fallback<FilePoll, HIVE_SIZE>;

/// We defer freeing FilePoll until the end of the next event loop iteration
/// This ensures that we don't free a FilePoll before the next callback is called
pub struct Store {
    hive: FilePollHive,
    pending_free_head: *mut FilePoll,
    pending_free_tail: *mut FilePoll,
}

impl Store {
    pub fn init() -> Store {
        Store {
            hive: FilePollHive::init(),
            pending_free_head: ptr::null_mut(),
            pending_free_tail: ptr::null_mut(),
        }
    }

    pub fn get(&mut self) -> *mut FilePoll {
        self.hive.get()
    }

    pub fn process_deferred_frees(&mut self) {
        let mut next = self.pending_free_head;
        while !next.is_null() {
            // SAFETY: intrusive list; nodes were allocated by this hive.
            let current = unsafe { &mut *next };
            next = current.next_to_free;
            current.next_to_free = ptr::null_mut();
            self.hive.put(current);
        }
        self.pending_free_head = ptr::null_mut();
        self.pending_free_tail = ptr::null_mut();
    }

    pub fn put(&mut self, poll: &mut FilePoll, vm: impl AbstractVm, ever_registered: bool) {
        if !ever_registered {
            self.hive.put(poll);
            return;
        }

        debug_assert!(poll.next_to_free.is_null());

        if !self.pending_free_tail.is_null() {
            debug_assert!(!self.pending_free_head.is_null());
            // SAFETY: tail is non-null and points into the hive.
            let tail = unsafe { &mut *self.pending_free_tail };
            debug_assert!(tail.next_to_free.is_null());
            tail.next_to_free = poll;
        }

        if self.pending_free_head.is_null() {
            self.pending_free_head = poll;
            debug_assert!(self.pending_free_tail.is_null());
        }

        poll.flags.insert(Flags::IgnoreUpdates);
        self.pending_free_tail = poll;

        let callback: OpaqueCallback = jsc::opaque_wrap::<Store, { Store::process_deferred_frees }>();
        // TODO(port): Zig asserts the callback slot is empty or already this fn.
        debug_assert!(
            vm.after_event_loop_callback().is_none()
                || vm.after_event_loop_callback() == Some(callback)
        );
        vm.set_after_event_loop_callback(callback);
        vm.set_after_event_loop_callback_ctx(self as *mut Store as *mut c_void);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// onTick (exported)
// ──────────────────────────────────────────────────────────────────────────

type Pollable = TaggedPtrUnion<(FilePoll,)>;

#[unsafe(no_mangle)]
pub extern "C" fn Bun__internal_dispatch_ready_poll(loop_: *mut Loop, tagged_pointer: *mut c_void) {
    let tag = Pollable::from(tagged_pointer);

    if tag.tag() != Pollable::tag_of::<FilePoll>() {
        return;
    }

    // SAFETY: tag matched FilePoll; pointer was set via Pollable::init in register_with_fd.
    let file_poll: &mut FilePoll = unsafe { &mut *tag.as_ptr::<FilePoll>() };
    if file_poll.flags.contains(Flags::IgnoreUpdates) {
        return;
    }

    // SAFETY: loop_ is the live uws loop; current_ready_poll indexes into ready_polls.
    let loop_ref = unsafe { &mut *loop_ };
    let idx = usize::try_from(loop_ref.current_ready_poll).unwrap();

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    {
        let ev = &loop_ref.ready_polls[idx] as *const _;
        // SAFETY: idx in bounds per loop contract.
        file_poll.on_kqueue_event(loop_ref, unsafe { &*ev });
    }
    #[cfg(target_os = "linux")]
    {
        let ev = &loop_ref.ready_polls[idx] as *const _;
        // SAFETY: idx in bounds per loop contract.
        file_poll.on_epoll_event(loop_ref, unsafe { &*ev });
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
// SAFETY: all-zero is a valid timespec
static TIMEOUT: bun_sys::posix::timespec = unsafe { core::mem::zeroed() };

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum OneShotFlag {
    Dispatch,
    OneShot,
    None,
}

const INVALID_FD: Fd = bun_sys::INVALID_FD;

// ──────────────────────────────────────────────────────────────────────────
// Waker
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub type Waker = KEventWaker;
// FreeBSD 13+ has eventfd(2), so the Linux waker works as-is.
#[cfg(any(target_os = "linux", target_os = "freebsd"))]
pub type Waker = LinuxWaker;
#[cfg(any(windows, target_arch = "wasm32"))]
compile_error!("unreachable");

pub struct LinuxWaker {
    pub fd: Fd,
}

impl LinuxWaker {
    pub fn init() -> Result<Self, bun_core::Error> {
        // TODO(port): std.posix.eventfd → bun_sys::eventfd
        let fd = bun_sys::eventfd(0, 0)?;
        Ok(Self::init_with_file_descriptor(Fd::from_native(fd)))
    }

    pub fn get_fd(&self) -> Fd {
        self.fd
    }

    pub fn init_with_file_descriptor(fd: Fd) -> Self {
        Self { fd }
    }

    pub fn wait(&self) {
        let mut bytes: usize = 0;
        // SAFETY: usize is 8 bytes on supported targets; reinterpret as [u8; 8].
        let buf = unsafe { &mut *(&mut bytes as *mut usize as *mut [u8; 8]) };
        let _ = bun_sys::posix::read(self.fd.cast(), buf);
    }

    pub fn wake(&self) {
        let mut bytes: usize = 1;
        // SAFETY: usize is 8 bytes; reinterpret as [u8; 8].
        let buf = unsafe { &*(&mut bytes as *mut usize as *mut [u8; 8]) };
        let _ = bun_sys::posix::write(self.fd.cast(), buf);
    }
}

#[cfg(target_os = "macos")]
pub struct KEventWaker {
    pub kq: bun_sys::posix::fd_t,
    pub machport: bun_core::mach_port,
    pub machport_buf: Box<[u8]>,
    pub has_pending_wake: bool,
}

#[cfg(target_os = "macos")]
impl KEventWaker {
    type Kevent64 = bun_sys::darwin::kevent64_s;

    // SAFETY: all-zero is a valid kevent64_s array
    const ZEROED: [Self::Kevent64; 16] = unsafe { core::mem::zeroed() };

    pub fn wake(&mut self) {
        bun_jsc::mark_binding!();
        // SAFETY: FFI call to io_darwin_schedule_wakeup with a valid mach_port.
        if unsafe { io_darwin_schedule_wakeup(self.machport) } {
            self.has_pending_wake = false;
            return;
        }
        self.has_pending_wake = true;
    }

    pub fn get_fd(&self) -> Fd {
        Fd::from_native(self.kq)
    }

    pub fn wait(&self) {
        if !Fd::from_native(self.kq).is_valid() {
            return;
        }
        bun_jsc::mark_binding!();
        let mut events = Self::ZEROED;
        // SAFETY: FFI syscall; pointers reference stack-local events array valid for the call.
        unsafe {
            bun_sys::darwin::kevent64(
                self.kq,
                events.as_ptr(),
                0,
                events.as_mut_ptr(),
                c_int::try_from(events.len()).unwrap(),
                0,
                ptr::null(),
            );
        }
    }

    pub fn init() -> Result<Self, bun_core::Error> {
        // TODO(port): std.posix.kqueue → bun_sys::kqueue
        let kq = bun_sys::posix::kqueue()?;
        Self::init_with_file_descriptor(kq)
    }

    pub fn init_with_file_descriptor(kq: i32) -> Result<Self, bun_core::Error> {
        bun_jsc::mark_binding!();
        debug_assert!(kq > -1);
        let mut machport_buf = vec![0u8; 1024].into_boxed_slice();
        // SAFETY: FFI call; buf outlives the machport.
        let machport = unsafe { io_darwin_create_machport(kq, machport_buf.as_mut_ptr() as *mut c_void, 1024) };
        if machport == 0 {
            return Err(bun_core::err!("MachportCreationFailed"));
        }

        Ok(Self {
            kq,
            machport,
            machport_buf,
            has_pending_wake: false,
        })
    }
}

// TODO(port): move to aio_sys
#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn io_darwin_close_machport(port: bun_core::mach_port);
    fn io_darwin_create_machport(
        kq: bun_sys::posix::fd_t,
        buf: *mut c_void,
        len: usize,
    ) -> bun_core::mach_port;
    fn io_darwin_schedule_wakeup(port: bun_core::mach_port) -> bool;
}

// ──────────────────────────────────────────────────────────────────────────
// Closer
// ──────────────────────────────────────────────────────────────────────────

pub struct Closer {
    pub fd: Fd,
    pub task: WorkPoolTask,
}

impl Closer {
    pub fn new(fd: Fd) -> Box<Self> {
        Box::new(Self {
            fd,
            task: WorkPoolTask {
                callback: Self::on_close,
            },
        })
    }

    /// `_compat` arg is for compatibility with the windows version.
    pub fn close(fd: Fd, _compat: ()) {
        debug_assert!(fd.is_valid());
        let closer = Box::into_raw(Self::new(fd));
        // SAFETY: closer is a valid heap allocation; task is the embedded field.
        WorkPool::schedule(unsafe { &mut (*closer).task });
    }

    fn on_close(task: *mut WorkPoolTask) {
        // SAFETY: task points to Closer.task; recover the parent via offset_of.
        let closer = unsafe {
            &mut *((task as *mut u8).sub(core::mem::offset_of!(Closer, task)) as *mut Closer)
        };
        // PORT NOTE: Zig `defer bun.destroy(closer)` — recover Box and let it drop after fd.close().
        // SAFETY: closer was Box::into_raw'd in Closer::close; reclaim ownership here.
        let closer_box = unsafe { Box::from_raw(closer as *mut Closer) };
        closer_box.fd.close();
        // closer_box dropped here
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/aio/posix_event_loop.zig (1414 lines)
//   confidence: medium
//   todos:      19
//   notes:      anytype event-loop ctx collapsed to `impl AbstractVm`; TaggedPtrUnion tag dispatch + cross-crate Owner type paths need Phase B wiring; unregister_with_fd split into wrapper+impl to express Zig `defer this.deactivate(loop)` without raw-pointer scopeguard.
// ──────────────────────────────────────────────────────────────────────────
