use core::fmt;
#[cfg(unix)]
use core::ptr;

#[cfg(not(windows))]
use bun_sys::{self as sys, Fd};
use bun_usockets::Loop as UwsLoop;

pub type Loop = UwsLoop;

bun_core::declare_scope!(KeepAlive, visible);

#[cfg(not(windows))]
use bun_sys::syslog;

pub use crate::{EventLoopCtx, EventLoopCtxKind, EventLoopKind};

unsafe extern "Rust" {
    /// Defined `#[no_mangle]` in `bun_runtime::jsc_hooks`.
    // safe: by-value enum arg only; the `#[no_mangle] pub fn` body in
    // `bun_runtime::jsc_hooks` is itself a safe fn (reads process globals) —
    // no memory-safety preconditions.
    safe fn __bun_get_vm_ctx(kind: AllocatorType) -> EventLoopCtx;
}

/// Kind of fd a `FilePoll` (or pipe reader/writer) is wrapping. Lives here so
/// `bun_io` (which now depends on this crate) and `FilePoll::file_type` share
/// one definition; `bun_io::pipes` re-exports it for downstream callers.
// Note: sunk one tier to break the
// io↔aio cycle (FilePoll::file_type was the only aio→io edge).
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum FileType {
    File,
    Pipe,
    NonblockingPipe,
    Socket,
}

impl FileType {
    pub fn is_pollable(self) -> bool {
        matches!(
            self,
            FileType::Pipe | FileType::NonblockingPipe | FileType::Socket
        )
    }

    pub fn is_blocking(self) -> bool {
        self == FileType::Pipe
    }
}

#[inline]
pub fn get_vm_ctx(kind: AllocatorType) -> EventLoopCtx {
    // Link-time-resolved Rust-ABI fn; `kind` selects between the
    // process-global JS VM and Mini loop, both initialised before any
    // `KeepAlive`/`FilePoll` caller reaches this.
    __bun_get_vm_ctx(kind)
}

/// JS-thread [`EventLoopCtx`] for `KeepAlive::{ref_,unref}` / `FilePoll`.
///
/// The crate split routes through the
/// link-time `__bun_get_vm_ctx` hook installed by `bun_runtime::init()`.
/// Every `Js`-tier caller (i.e. everything outside the install/Mini loop)
/// wants exactly `get_vm_ctx(AllocatorType::Js)`, so this shorthand replaces
/// the ~21 byte-identical local wrappers each ported file grew independently.
#[inline]
pub fn js_vm_ctx() -> EventLoopCtx {
    get_vm_ctx(AllocatorType::Js)
}

// `KeepAlive` (struct + 14-method impl) was duplicated here and in
// `windows_event_loop.rs`; both copies now live in `crate::keep_alive`.

// ──────────────────────────────────────────────────────────────────────────
// FilePoll — registered through the bun_usockets poll registry. No raw
// epoll_ctl/kevent here: kernel mechanics live in src/usockets/backend/.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// FilePoll Owner — hot-path tag+ptr (CYCLEBREAK §Hot dispatch list).
// Low tier (here) stores `(tag: u8, ptr: *mut ())`; `bun_runtime::dispatch::on_poll`
// owns the per-tag `match` so the variant types are never named in this crate.
// ──────────────────────────────────────────────────────────────────────────

/// Closed set of `FilePoll` owner kinds. Variant types live in higher-tier
/// crates; `__bun_run_file_poll` (link-time, in `bun_runtime::dispatch`)
/// matches on this and calls the per-kind handler directly — same enum-dispatch
/// shape as `EventLoopCtx`, with the match on the runtime side because there
/// are 13 variants × 1 dispatch fn (vs 2 × 9 for `EventLoopCtx`).
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PollTag {
    Null = 0,
    FileSink,
    StaticPipeWriter,
    ShellStaticPipeWriter,
    SecurityScanStaticPipeWriter,
    BufferedReader,
    DnsResolver,
    GetAddrInfoRequest,
    Request,
    Process,
    ShellBufferedWriter,
    TerminalPoll,
    ParentDeathWatchdog,
    LifecycleScriptSubprocessOutputReader,
    MemoryPressure,
}

/// Compatibility module — call sites in `bun_runtime`/`bun_install` still spell
/// `poll_tag::FILE_SINK`. Re-export the enum variants under the old constant
/// names; the literal values are unchanged. New code should use
/// `PollTag::FileSink` directly.
pub mod poll_tag {
    use super::PollTag;
    pub const NULL: PollTag = PollTag::Null;
    pub const FILE_SINK: PollTag = PollTag::FileSink;
    pub const STATIC_PIPE_WRITER: PollTag = PollTag::StaticPipeWriter;
    pub const SHELL_STATIC_PIPE_WRITER: PollTag = PollTag::ShellStaticPipeWriter;
    pub const SECURITY_SCAN_STATIC_PIPE_WRITER: PollTag = PollTag::SecurityScanStaticPipeWriter;
    pub const BUFFERED_READER: PollTag = PollTag::BufferedReader;
    pub const DNS_RESOLVER: PollTag = PollTag::DnsResolver;
    pub const GET_ADDR_INFO_REQUEST: PollTag = PollTag::GetAddrInfoRequest;
    pub const REQUEST: PollTag = PollTag::Request;
    pub const PROCESS: PollTag = PollTag::Process;
    pub const SHELL_BUFFERED_WRITER: PollTag = PollTag::ShellBufferedWriter;
    pub const TERMINAL_POLL: PollTag = PollTag::TerminalPoll;
    pub const PARENT_DEATH_WATCHDOG: PollTag = PollTag::ParentDeathWatchdog;
    pub const LIFECYCLE_SCRIPT_SUBPROCESS_OUTPUT_READER: PollTag =
        PollTag::LifecycleScriptSubprocessOutputReader;
    pub const MEMORY_PRESSURE: PollTag = PollTag::MemoryPressure;
}

#[derive(Copy, Clone)]
pub struct Owner {
    pub tag: PollTag,
    pub ptr: *mut (),
}

impl Owner {
    pub const NULL: Owner = Owner {
        tag: PollTag::Null,
        ptr: core::ptr::null_mut(),
    };
    #[inline]
    pub const fn new(tag: PollTag, ptr: *mut ()) -> Owner {
        Owner { tag, ptr }
    }
    #[inline]
    pub fn is_null(&self) -> bool {
        self.ptr.is_null()
    }
    #[inline]
    pub fn clear(&mut self) {
        *self = Self::NULL;
    }
    #[inline]
    pub fn tag(&self) -> PollTag {
        self.tag
    }
}

unsafe extern "Rust" {
    fn __bun_run_file_poll(poll: *mut crate::FilePoll, size_or_offset: i64);
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum AllocatorType {
    #[default]
    Js,
    Mini,
}

// `FilePoll`/`Store` here are POSIX-specific (registry registration,
// allocator_type). On Windows the variants live in `windows_event_loop`; the
// shared `EventLoopCtxVTable` above names `crate::FilePoll`/`crate::Store`
// so the right one is picked.
#[cfg(not(windows))]
pub struct FilePoll {
    pub fd: Fd,
    pub flags: FlagsSet,
    pub owner: Owner,

    /// Live core-registry registration (kernel arm). `None` = disarmed
    /// (never registered, one-shot already fired, or unregistered).
    registration: Option<Registration>,

    pub allocator_type: AllocatorType,
}

/// One armed registry slot. INVARIANT: released only via
/// [`FilePoll::drop_registration`]/[`FilePoll::drop_registration_on`] —
/// `poll_ref.unregister{,_on}()` (kernel disarm + generation bump; stale
/// same-tick events are dropped core-side), then the shim backpointer is
/// nulled, then our shim ref is released.
#[cfg(not(windows))]
struct Registration {
    poll_ref: bun_usockets::PollRef,
    /// Owned strong ref (`RefPtr` has no Drop); discharged in
    /// `drop_registration`. The registry slot + dispatch guard hold their own.
    shim: bun_ptr::RefPtr<RegistryShim>,
}

/// Refcounted dispatch owner handed to the core registry. Holds the address
/// of the hive-resident `FilePoll` (exposed provenance — a stored `*mut`
/// would be invalidated by every later owner-side `&mut FilePoll` under
/// Stacked/Tree Borrows); zeroed before the slot can be recycled, so a
/// late-held guard ref can never dispatch into a reused slot.
#[cfg(not(windows))]
#[derive(bun_ptr::RefCounted)]
struct RegistryShim {
    ref_count: bun_ptr::RefCount<RegistryShim>,
    poll: core::cell::Cell<usize>,
}

#[cfg(not(windows))]
struct FilePollProtocol;

#[cfg(not(windows))]
impl bun_usockets::PollProtocol for FilePollProtocol {
    type Owner = RegistryShim;

    fn on_event(
        shim: &RegistryShim,
        _poll: bun_usockets::PollRef,
        events: bun_usockets::PollEvents,
    ) {
        let addr = shim.poll.get();
        if addr == 0 {
            return;
        }
        // Provenance: reconstruct from the address exposed at `arm` — the
        // transient `&mut`'s tag there is long invalidated by owner-side
        // borrows, so only the exposed-provenance round-trip is sound.
        let ptr = ptr::with_exposed_provenance_mut::<FilePoll>(addr);
        // SAFETY: `poll` is zeroed in `drop_registration` before the hive
        // slot is recycled, and the loop is single-threaded, so a nonzero
        // backpointer is a live slot. The `&mut` is SCOPED to this statement:
        // it ends before the dispatch below, whose handler may deinit
        // (recycle or free) the slot — a live protected `&mut` across that
        // call would be deallocation under a protector (SB-UB).
        let size_or_offset = unsafe { &mut *ptr }.prepare_registry_event(events);
        // SAFETY: `ptr` is still live (nothing ran since the borrow above;
        // this thread is the sole accessor). The handler owns any subsequent
        // deinit; `ptr` is never touched after the call.
        unsafe { __bun_run_file_poll(ptr, size_or_offset) };
    }
}

#[cfg(not(windows))]
impl Default for FilePoll {
    fn default() -> Self {
        Self {
            fd: INVALID_FD,
            flags: FlagsSet::empty(),
            owner: Owner::NULL,
            registration: None,
            allocator_type: AllocatorType::Js,
        }
    }
}

#[cfg(not(windows))]
impl FilePoll {
    fn update_flags(&mut self, updated: FlagsSet) {
        let mut flags = self.flags;
        flags.remove(Flags::Readable);
        flags.remove(Flags::Writable);
        flags.remove(Flags::Process);
        flags.remove(Flags::Machport);
        flags.remove(Flags::MemoryPressure);
        flags.remove(Flags::Eof);
        flags.remove(Flags::Hup);

        flags |= updated;
        self.flags = flags;
    }

    pub fn file_type(&self) -> FileType {
        let flags = self.flags;
        if flags.contains(Flags::Socket) {
            return FileType::Socket;
        }
        if flags.contains(Flags::Nonblocking) {
            return FileType::NonblockingPipe;
        }
        FileType::Pipe
    }

    /// Release the registry slot: kernel disarm + slot free (generation bump
    /// drops same-tick stale events core-side), null the shim backpointer,
    /// then release our shim ref. Safe from inside `on_registry_event` — the
    /// core dispatch guard keeps the shim alive until dispatch returns.
    fn drop_registration(&mut self) {
        if let Some(reg) = self.registration.take() {
            reg.poll_ref.unregister();
            Self::release_shim(reg);
        }
    }

    /// [`Self::drop_registration`] for frames holding a `&mut Loop`: the
    /// registry disarm routes through that borrow — a write through the
    /// slot's stored loop pointer would be foreign under its protector.
    fn drop_registration_on(&mut self, loop_: &mut Loop) {
        if let Some(reg) = self.registration.take() {
            reg.poll_ref.unregister_on(loop_);
            Self::release_shim(reg);
        }
    }

    fn release_shim(reg: Registration) {
        reg.shim.data().poll.set(0);
        reg.shim.deref();
    }

    /// Flag mapping + one-shot disarm for a delivered registry event; returns
    /// the `size_or_offset` payload for `__bun_run_file_poll`. Deliberately
    /// does NOT dispatch: the `&mut self` borrow must end before the handler
    /// runs (it may deinit this very poll).
    fn prepare_registry_event(&mut self, events: bun_usockets::PollEvents) -> i64 {
        let mut updated = FlagsSet::empty();
        // Single-purpose sources (proc exit, machport, memory pressure)
        // report which kind fired via the registered-kind flag; Fd sources
        // report the direction bits. Error/EOF-only deliveries (Linux PSI
        // EPOLLERR without EPOLLPRI) carry no kind flag — old
        // from_epoll_event parity: they surface via the Eof/Hup mapping only.
        if events.readable || events.writable {
            if self.flags.contains(Flags::PollProcess) {
                updated.insert(Flags::Process);
            } else if self.flags.contains(Flags::PollMachport) {
                updated.insert(Flags::Machport);
            } else if self.flags.contains(Flags::PollMemoryPressure) {
                updated.insert(Flags::MemoryPressure);
            } else {
                if events.readable {
                    updated.insert(Flags::Readable);
                }
                if events.writable {
                    updated.insert(Flags::Writable);
                }
            }
        }
        if events.eof {
            updated.insert(Flags::Hup);
        }
        // EPOLLERR → Eof parity (kqueue reported no error bit to FilePolls).
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if events.error {
            updated.insert(Flags::Eof);
        }

        // kqueue filter payload: NOTE_EXIT status / bytes available in
        // `data`; EVFILT_MEMORYSTATUS pressure level in `fflags`.
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let size_or_offset: i64 = if self.flags.contains(Flags::PollMemoryPressure) {
            i64::from(events.fflags)
        } else {
            events.data
        };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let size_or_offset: i64 = 0;

        self.update_flags(updated);
        syslog!("onRegistryEvent: {}", self);

        // One-shot parity: the kernel used to auto-disarm before the
        // callback; the registry is level-triggered, so disarm here — a
        // handler that re-registers gets a fresh slot.
        if self.flags.contains(Flags::OneShot) {
            self.drop_registration();
            self.flags.insert(Flags::NeedsRearm);
        }

        debug_assert!(!self.owner.is_null());
        size_or_offset
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

    // Note: not `impl Drop` — FilePoll is pool-allocated (HiveArray) and explicitly
    // put back via `Store::put`; Drop would be wrong here.
    pub fn deinit(&mut self) {
        let ctx = get_vm_ctx(self.allocator_type);
        self.deinit_possibly_defer(ctx, false);
    }

    pub fn deinit_force_unregister(&mut self) {
        let ctx = get_vm_ctx(self.allocator_type);
        self.deinit_possibly_defer(ctx, true);
    }

    fn deinit_possibly_defer(&mut self, vm: EventLoopCtx, force_unregister: bool) {
        // `loop_mut()` is the crate-private nonnull-asref accessor (single
        // deref in `EventLoopCtx`); the `&mut Loop` is consumed by `unregister`
        // and dropped before any `&mut Store` is materialised.
        let _ = self.unregister(vm.loop_mut(), force_unregister);
        // Belt-and-braces: the needs-rearm skip leaves `registration` None,
        // but a leaked slot here would keep a dangling shim backpointer.
        self.drop_registration_on(vm.loop_mut());

        self.owner.clear();
        self.flags = FlagsSet::empty();
        self.fd = INVALID_FD;
        // `self` may live inside the `Store.hive` inline array, so a
        // `&mut Store` taken while `&mut self` is live would assert unique
        // access over the slot and invalidate `self`'s tag (Stacked Borrows).
        // Decay `self` to a raw slot pointer first, *then* materialise the
        // `&mut Store` via the crate-private backref-deref accessor.
        // Immediate reuse is safe: the registry's generation bump + pending
        // ready-list nulling (the core closed-drain) drop any stale event.
        let this = ptr::NonNull::from(self);
        vm.file_polls_mut().put(this);
    }

    pub fn deinit_with_vm(&mut self, vm: EventLoopCtx) {
        self.deinit_possibly_defer(vm, false);
    }

    pub fn is_registered(&self) -> bool {
        self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport)
            || self.flags.contains(Flags::PollMemoryPressure)
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
    pub fn disable_keeping_process_alive(&mut self, event_loop_ctx: EventLoopCtx) {
        event_loop_ctx
            .loop_sub_active(self.flags.contains(Flags::HasIncrementedActiveCount) as u32);

        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.remove(Flags::HasIncrementedActiveCount);
    }

    #[inline]
    pub fn can_enable_keeping_process_alive(&self) -> bool {
        self.flags.contains(Flags::KeepsEventLoopAlive)
            && self.flags.contains(Flags::HasIncrementedPollCount)
    }

    pub fn set_keeping_process_alive(&mut self, event_loop_ctx: EventLoopCtx, value: bool) {
        if value {
            self.enable_keeping_process_alive(event_loop_ctx);
        } else {
            self.disable_keeping_process_alive(event_loop_ctx);
        }
    }

    pub fn enable_keeping_process_alive(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }

        event_loop_ctx
            .loop_add_active((!self.flags.contains(Flags::HasIncrementedActiveCount)) as u32);

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

    /// Build a fully-initialized `FilePoll` value for `Store::get_init`.
    ///
    /// Note: the previous `&mut *pool.get()` + field-assign pattern was
    /// instant validity UB — `FilePoll.owner`/`allocator_type` are enums with
    /// niches, and `&mut FilePoll` over an uninitialized hive slot asserts a
    /// valid discriminant. Building the whole struct by value fixes that.
    #[inline]
    fn new_value(vm: EventLoopCtx, fd: Fd, flags: FlagsSet, owner: Owner) -> FilePoll {
        FilePoll {
            fd,
            flags,
            owner,
            registration: None,
            allocator_type: if vm.is_js() {
                AllocatorType::Js
            } else {
                AllocatorType::Mini
            },
        }
    }

    // Note: callers normalize to EventLoopCtx before calling.
    pub fn init(vm: EventLoopCtx, fd: Fd, flags: FlagsSet, owner: Owner) -> *mut FilePoll {
        let value = Self::new_value(vm, fd, flags, owner);
        let poll = vm.alloc_file_poll(value).as_ptr();
        syslog!("FilePoll.init(0x{:x}, fd={})", poll as usize, fd);
        poll
    }

    #[inline]
    pub fn can_ref(&self) -> bool {
        !self.flags.contains(Flags::HasIncrementedPollCount)
    }

    #[inline]
    pub fn can_unref(&self) -> bool {
        self.flags.contains(Flags::HasIncrementedPollCount)
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, event_loop_ctx: EventLoopCtx) {
        syslog!("unref");
        self.disable_keeping_process_alive(event_loop_ctx);
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }
        syslog!("ref");
        self.enable_keeping_process_alive(event_loop_ctx);
    }

    pub fn on_ended(&mut self, event_loop_ctx: EventLoopCtx) {
        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.insert(Flags::Closed);
        // `loop_mut()` — crate-private nonnull-asref accessor; `deactivate` is
        // a leaf counter op so the `&mut Loop` borrow does not escape.
        self.deactivate(event_loop_ctx.loop_mut());
    }

    #[inline]
    pub fn file_descriptor(&self) -> Fd {
        self.fd
    }

    pub fn register(&mut self, loop_: &mut Loop, flag: Flags, one_shot: bool) -> sys::Result<()> {
        self.register_with_fd(
            loop_,
            flag,
            if one_shot {
                OneShotFlag::OneShot
            } else {
                OneShotFlag::None
            },
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
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        ))]
        return self.register_with_fd_impl(loop_, flag, one_shot, fd);
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        {
            let _ = (loop_, flag, one_shot, fd);
            sys::Result::Ok(())
        }
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    fn register_with_fd_impl(
        &mut self,
        loop_: &mut Loop,
        flag: Flags,
        one_shot: OneShotFlag,
        fd: Fd,
    ) -> sys::Result<()> {
        syslog!(
            "register: FilePoll(0x{:x}) {} ({})",
            std::ptr::from_mut(self) as usize,
            <&'static str>::from(flag),
            fd
        );

        debug_assert!(fd != INVALID_FD);

        if one_shot != OneShotFlag::None {
            self.flags.insert(Flags::OneShot);
        }

        // Bidirectional one-shot is unsupported (kernel parity: EPOLLONESHOT
        // disarmed the whole fd after either direction fired).
        if (flag == Flags::Readable && self.flags.contains(Flags::PollWritable))
            || (flag == Flags::Writable && self.flags.contains(Flags::PollReadable))
        {
            debug_assert!(!self.flags.contains(Flags::OneShot));
        }

        let result = self.arm(loop_, flag, fd);
        self.flags.insert(Flags::WasEverRegistered);
        if let sys::Result::Err(err) = result {
            self.deactivate(loop_);
            return sys::Result::Err(err);
        }

        self.activate(loop_);
        self.flags.insert(match flag {
            Flags::Readable => Flags::PollReadable,
            Flags::Process => {
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    Flags::PollReadable
                }
                #[cfg(not(any(target_os = "linux", target_os = "android")))]
                {
                    Flags::PollProcess
                }
            }
            Flags::Writable => Flags::PollWritable,
            Flags::Machport => Flags::PollMachport,
            Flags::MemoryPressure => Flags::PollMemoryPressure,
            _ => unreachable!(),
        });
        self.flags.remove(Flags::NeedsRearm);

        sys::Result::Ok(())
    }

    /// Kernel-arm through the core poll registry: interest-set update on the
    /// live slot for Fd directions, or a fresh slot registration (first
    /// registration and post-one-shot rearm both land here).
    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    fn arm(&mut self, loop_: &mut Loop, flag: Flags, fd: Fd) -> sys::Result<()> {
        use bun_usockets::PollSource;

        #[cfg(any(target_os = "linux", target_os = "android"))]
        const REGISTER_TAG: sys::Tag = sys::Tag::epoll_ctl;
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        const REGISTER_TAG: sys::Tag = sys::Tag::kevent;

        // On Linux a process watch is a readable pidfd — an Fd direction.
        let is_fd_direction = matches!(flag, Flags::Readable | Flags::Writable)
            || (cfg!(any(target_os = "linux", target_os = "android")) && flag == Flags::Process);

        if let Some(reg) = &self.registration {
            // Already armed. Fd sources take the union of the live directions
            // plus `flag`; single-purpose sources (proc/machport/
            // memorystatus) are level-armed already — nothing to change.
            let poll_ref = reg.poll_ref;
            if is_fd_direction {
                let readable = matches!(flag, Flags::Readable | Flags::Process)
                    || self.flags.contains(Flags::PollReadable);
                let writable = flag == Flags::Writable || self.flags.contains(Flags::PollWritable);
                if let Err(errno) = poll_ref.change_on(loop_, readable, writable) {
                    // Failed rearm: fully disarm so the kernel, the registry
                    // slot, and the interest flags all agree with the failure
                    // the caller is told (register_with_fd_impl deactivates).
                    self.drop_registration_on(loop_);
                    self.flags.remove(Flags::PollReadable);
                    self.flags.remove(Flags::PollWritable);
                    self.flags.remove(Flags::PollProcess);
                    self.flags.remove(Flags::PollMachport);
                    self.flags.remove(Flags::PollMemoryPressure);
                    return sys::Result::Err(sys::Error::from_code(
                        sys::SystemErrno::init(i64::from(errno)).unwrap_or(sys::E::EINVAL),
                        REGISTER_TAG,
                    ));
                }
            }
            return sys::Result::Ok(());
        }

        let source = match flag {
            Flags::Readable | Flags::Writable => {
                let readable = flag == Flags::Readable || self.flags.contains(Flags::PollReadable);
                let writable = flag == Flags::Writable || self.flags.contains(Flags::PollWritable);
                PollSource::Fd {
                    fd: fd.native(),
                    readable,
                    writable,
                }
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            Flags::Process => PollSource::Fd {
                fd: fd.native(),
                readable: true,
                writable: false,
            },
            // PSI trigger fds signal via EPOLLPRI only.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            Flags::MemoryPressure => PollSource::Pri { fd: fd.native() },
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            Flags::Process => PollSource::Proc { pid: fd.native() },
            #[cfg(target_os = "macos")]
            Flags::Machport => PollSource::Machport {
                port: u32::try_from(fd.native()).expect("int cast"),
            },
            #[cfg(target_os = "macos")]
            Flags::MemoryPressure => PollSource::Memorystatus,
            #[cfg(target_os = "freebsd")]
            Flags::Machport | Flags::MemoryPressure => {
                return sys::Result::Err(sys::Error::from_code(
                    sys::E::EOPNOTSUPP,
                    sys::Tag::kevent,
                ));
            }
            _ => unreachable!(),
        };

        let shim = bun_ptr::RefPtr::new(RegistryShim {
            ref_count: bun_ptr::RefCount::init(),
            poll: core::cell::Cell::new(std::ptr::from_mut(self).expose_provenance()),
        });
        // One strong ref transfers to the registry slot; ours lives in
        // `Registration` and is discharged in `drop_registration`.
        match loop_.register_poll::<FilePollProtocol>(source, shim.dupe_ref(), false) {
            Ok(poll_ref) => {
                self.registration = Some(Registration { poll_ref, shim });
                sys::Result::Ok(())
            }
            Err(errno) => {
                shim.data().poll.set(0);
                shim.deref();
                sys::Result::Err(sys::Error::from_code(
                    sys::SystemErrno::init(i64::from(errno)).unwrap_or(sys::E::EINVAL),
                    REGISTER_TAG,
                ))
            }
        }
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
        // Note: compute the syscall result first, then unconditionally
        // deactivate. Avoids a raw-pointer scopeguard.
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        ))]
        let result = self.unregister_with_fd_impl(loop_, fd, force_unregister);
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        let result: sys::Result<()> = {
            let _ = (fd, force_unregister);
            sys::Result::Ok(())
        };
        self.deactivate(loop_);
        result
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    fn unregister_with_fd_impl(
        &mut self,
        loop_: &mut Loop,
        fd: Fd,
        force_unregister: bool,
    ) -> sys::Result<()> {
        #[cfg(debug_assertions)]
        debug_assert!(fd.native() >= 0 && fd != INVALID_FD);

        if !self.is_registered() {
            return sys::Result::Ok(());
        }

        if self.flags.contains(Flags::NeedsRearm) && !force_unregister {
            // The one-shot delivery already released its registry slot.
            debug_assert!(self.registration.is_none());
            syslog!("unregister: ({}) skipped due to needs_rearm", fd);
            self.flags.remove(Flags::PollProcess);
            self.flags.remove(Flags::PollReadable);
            self.flags.remove(Flags::PollWritable);
            self.flags.remove(Flags::PollMachport);
            self.flags.remove(Flags::PollMemoryPressure);
            return sys::Result::Ok(());
        }

        syslog!(
            "unregister: FilePoll(0x{:x}) ({})",
            std::ptr::from_mut(self) as usize,
            fd
        );

        // Kernel disarm + slot free happen core-side; already-gone
        // registrations (fd closed while registered, pty knotes reaped on
        // EV_EOF|EV_ONESHOT hangup) are tolerated there, matching libuv.
        self.drop_registration_on(loop_);

        self.flags.remove(Flags::NeedsRearm);
        self.flags.remove(Flags::OneShot);
        self.flags.remove(Flags::PollReadable);
        self.flags.remove(Flags::PollWritable);
        self.flags.remove(Flags::PollProcess);
        self.flags.remove(Flags::PollMachport);
        self.flags.remove(Flags::PollMemoryPressure);

        sys::Result::Ok(())
    }
}

#[cfg(not(windows))]
impl fmt::Display for FilePoll {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "FilePoll(fd={}) = {}",
            self.fd,
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
    /// Poll for memory-pressure events (Darwin `EVFILT_MEMORYSTATUS`, Linux PSI `EPOLLPRI`)
    PollMemoryPressure,

    // What did the event loop tell us?
    Readable,
    Writable,
    Process,
    Eof,
    Hup,
    Machport,
    MemoryPressure,

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

    /// Was O_NONBLOCK set on the file descriptor?
    Nonblock,

    Socket,
}

pub type FlagsSet = enumset::EnumSet<Flags>;
pub type FlagsStruct = FlagsSet;

impl Flags {
    pub fn poll(self) -> Flags {
        match self {
            Flags::Readable => Flags::PollReadable,
            Flags::Writable => Flags::PollWritable,
            Flags::Process => Flags::PollProcess,
            Flags::Machport => Flags::PollMachport,
            Flags::MemoryPressure => Flags::PollMemoryPressure,
            other => other,
        }
    }
}

#[allow(dead_code)]
pub(crate) struct FlagsFormatter(pub FlagsSet);

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

// `bun_alloc::heap_breakdown` is a no-op outside macOS Instruments
// heap-breakdown builds, so the 128-slot hive is unconditional here (same
// choice as `RuntimeTranspilerStore`'s TranspilerJob hive).
#[cfg(not(windows))]
const HIVE_SIZE: usize = 128;
#[cfg(not(windows))]
type FilePollHive = bun_collections::hive_array::Fallback<FilePoll, HIVE_SIZE>;

/// FilePoll slot pool. Freed slots are recycled immediately: staleness
/// protection moved core-side (the registry slot is the kernel udata; its
/// generation bump + pending ready-list nulling drop any same-tick event, and
/// the dispatch shim backpointer is nulled before the slot returns here).
#[cfg(not(windows))]
pub struct Store {
    hive: FilePollHive,
}

#[cfg(not(windows))]
impl Store {
    pub fn init() -> Store {
        Store {
            hive: FilePollHive::init(),
        }
    }

    /// Claim a hive slot and move `value` into it. Infallible (heap fallback).
    #[inline]
    pub fn get_init(&mut self, value: FilePoll) -> ptr::NonNull<FilePoll> {
        self.hive.get_init(value)
    }

    /// `poll` is a live, fully-initialized slot in `self.hive`. It may point
    /// *inside* `self.hive`'s inline `[FilePoll; 128]` buffer, so accepting it
    /// as `&mut FilePoll` while `&mut self` is live would retag overlapping
    /// storage under Stacked Borrows (UB). Take it as a raw pointer instead.
    pub fn put(&mut self, poll: ptr::NonNull<FilePoll>) {
        // SAFETY: `poll` is a fully-initialized hive slot whose registration
        // was already released (deinit contract); FilePoll has no drop glue,
        // so `put` is a no-op drop + recycle.
        unsafe { self.hive.put(poll.as_ptr()) };
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum OneShotFlag {
    Dispatch,
    OneShot,
    None,
}

#[cfg(not(windows))]
const INVALID_FD: Fd = Fd::INVALID;

// ──────────────────────────────────────────────────────────────────────────
// Waker / Closer — canonical impls live in this crate's `mod waker` /
// `mod closer` (lib.rs). Before the bun_io→bun_io merge each crate had its
// own copy (this file was bun_io's, lib.rs was bun_io's, kept apart so
// `Loop::load` had no aio→io edge). With the merge there is one definition;
// re-export here so `posix_event_loop::Waker` / `::Closer` (and therefore
// the `bun_io::*` shim) keep resolving for downstream callers.
// ──────────────────────────────────────────────────────────────────────────

pub use crate::closer::Closer;
#[cfg(target_os = "macos")]
pub use crate::waker::KEventWaker;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
pub use crate::waker::Waker;
