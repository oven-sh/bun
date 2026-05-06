//! `bun_runtime::dispatch` — the §Dispatch hot-path payoff.
//!
//! Per `docs/PORTING.md` §Dispatch, low-tier crates store
//! `Task = { tag: TaskTag, ptr: *mut () }` and never name a variant type. This
//! crate (highest tier) owns **every** variant type, so the actual `match`
//! loop lives here. LLVM inlines the per-arm direct calls exactly as Zig's
//! `switch (task.tag()) { inline else => |p| p.run() }` did.
//!
//! Three dispatchers are defined:
//!   1. [`run_task`] — `bun_event_loop::Task` (~96 variants; src/jsc/Task.zig).
//!      Registered into `bun_jsc::RUN_TASK_HOOK` / `TICK_QUEUE_HOOK`.
//!   2. [`run_file_poll`] — `bun_aio::FilePoll::Owner` (~13 variants;
//!      src/aio/posix_event_loop.zig `FilePoll.onUpdate`). Registered into
//!      `bun_aio::posix_event_loop::ON_POLL_DISPATCH`.
//!   3. [`install_dispatch_hooks`] — one-shot init wiring both. Called from
//!      `main.rs` before the first event-loop tick.
//!
//! **Adding a variant** (do all three):
//!   1. tag constant in `bun_event_loop::task_tag` (or `bun_aio::poll_tag`);
//!   2. `impl bun_jsc::Taskable for YourType { const TAG = task_tag::YourType; }`;
//!   3. a match arm here.

use core::sync::atomic::Ordering;

use bun_event_loop::{task_tag, Task, TaskTag};
use bun_event_loop::AnyTask::AnyTask;
use bun_event_loop::ManagedTask::ManagedTask;

use bun_aio::posix_event_loop::{poll_tag, FilePoll, Flags as PollFlag, ON_POLL_DISPATCH};

use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, Tag as EventLoopTimerTag, TimerCallback, Timespec as ElTimespec, FIRE_TIMER,
    JS_TIMER_EPOCH,
};

// ════════════════════════════════════════════════════════════════════════════
// Task dispatch (src/jsc/Task.zig `tickQueueWithCount` switch)
// ════════════════════════════════════════════════════════════════════════════

/// Dispatch a single `Task` to its variant's `run`-style entry point.
///
/// This is the body of one iteration of Zig `tickQueueWithCount`'s `while`
/// loop (the per-item `switch`). The surrounding drain loop + microtask flush
/// lives in [`tick_queue_with_count`] below (gated until `bun_jsc` is a dep).
///
/// Arms whose payload type is still ``-gated in this crate are
/// `todo!("dispatch: …")` placeholders so the table stays exhaustive against
/// `task_tag::COUNT`; un-gating a type means swapping its arm body in-place.
// PERF(port): was inline switch — Zig `inline else` monomorphized every arm.
// The `match` below preserves direct-call inlining; profile in Phase B.
#[inline]
pub fn run_task(task: Task) {
    /// `*(task.ptr as *mut T)` with the SAFETY invariant spelled once.
    macro_rules! cast {
        ($ty:ty) => {{
            // SAFETY: §Dispatch — `task.tag` was set together with `task.ptr`
            // by `Taskable::into_task`/`Task::new`; tag uniquely identifies
            // the pointee type and the pointer is live for this dispatch.
            unsafe { &mut *(task.ptr as *mut $ty) }
        }};
    }

    // NB: `TaskTag` is `#[derive(PartialEq, Eq)]` over `u8` → structural-match
    // eligible, so const patterns work directly.
    match task.tag {
        // ── erased-callback tasks (low-tier types — real) ────────────────
        task_tag::AnyTask => {
            let any = cast!(AnyTask);
            // Zig: `any.run() catch |err| reportErrorOrTerminate(global, err)`.
            // TODO(b2-blocked): bun_jsc::task::report_error_or_terminate —
            // route the JsError once `bun_jsc` is a dep.
            let _ = any.run();
        }
        task_tag::ManagedTask => {
            // Zig: `any.run() catch |err| reportErrorOrTerminate(global, err)`.
            // TODO(b2-blocked): bun_jsc::task::report_error_or_terminate.
            let _ = ManagedTask::run(task.ptr as *mut ManagedTask);
        }
        task_tag::CppTask => {
            // Zig: `any.run(global) catch |err| reportErrorOrTerminate(global, err)`.
            todo!("dispatch: CppTask")
        }

        // ── archive ──────────────────────────────────────────────────────
        task_tag::ArchiveExtractTask => todo!("dispatch: ArchiveExtractTask"),
        task_tag::ArchiveBlobTask => todo!("dispatch: ArchiveBlobTask"),
        task_tag::ArchiveWriteTask => todo!("dispatch: ArchiveWriteTask"),
        task_tag::ArchiveFilesTask => todo!("dispatch: ArchiveFilesTask"),

        // ── shell interpreter ────────────────────────────────────────────
        task_tag::ShellAsync => todo!("dispatch: ShellAsync"),
        task_tag::ShellAsyncSubprocessDone => todo!("dispatch: ShellAsyncSubprocessDone"),
        task_tag::ShellIOWriterAsyncDeinit => todo!("dispatch: ShellIOWriterAsyncDeinit"),
        task_tag::ShellIOWriter => todo!("dispatch: ShellIOWriter"),
        task_tag::ShellIOReaderAsyncDeinit => todo!("dispatch: ShellIOReaderAsyncDeinit"),
        task_tag::ShellCondExprStatTask => todo!("dispatch: ShellCondExprStatTask"),
        task_tag::ShellCpTask => todo!("dispatch: ShellCpTask"),
        task_tag::ShellTouchTask => todo!("dispatch: ShellTouchTask"),
        task_tag::ShellMkdirTask => todo!("dispatch: ShellMkdirTask"),
        task_tag::ShellLsTask => todo!("dispatch: ShellLsTask"),
        task_tag::ShellMvBatchedTask => todo!("dispatch: ShellMvBatchedTask"),
        task_tag::ShellMvCheckTargetTask => todo!("dispatch: ShellMvCheckTargetTask"),
        task_tag::ShellRmTask => todo!("dispatch: ShellRmTask"),
        task_tag::ShellRmDirTask => todo!("dispatch: ShellRmDirTask"),
        task_tag::ShellGlobTask => todo!("dispatch: ShellGlobTask"),
        task_tag::ShellYesTask => todo!("dispatch: ShellYesTask"),

        // ── fetch / S3 ───────────────────────────────────────────────────
        task_tag::FetchTasklet => todo!("dispatch: FetchTasklet"),
        task_tag::S3HttpSimpleTask => todo!("dispatch: S3HttpSimpleTask"),
        task_tag::S3HttpDownloadStreamingTask => {
            todo!("dispatch: S3HttpDownloadStreamingTask")
        }

        // ── glob / image / transpiler ────────────────────────────────────
        task_tag::AsyncGlobWalkTask => todo!("dispatch: AsyncGlobWalkTask"),
        task_tag::AsyncImageTask => todo!("dispatch: AsyncImageTask"),
        task_tag::AsyncTransformTask => todo!("dispatch: AsyncTransformTask"),

        // ── blob copy/read/write promise tasks ───────────────────────────
        task_tag::CopyFilePromiseTask => todo!("dispatch: CopyFilePromiseTask"),
        task_tag::ReadFileTask => todo!("dispatch: ReadFileTask"),
        task_tag::WriteFileTask => todo!("dispatch: WriteFileTask"),

        // ── napi ─────────────────────────────────────────────────────────
        task_tag::NapiAsyncWork => todo!("dispatch: napi_async_work"),
        task_tag::ThreadSafeFunction => todo!("dispatch: ThreadSafeFunction"),
        task_tag::NapiFinalizerTask => todo!("dispatch: NapiFinalizerTask"),

        // ── JSC scheduler / module loader ────────────────────────────────
        task_tag::JSCDeferredWorkTask => todo!("dispatch: JSCDeferredWorkTask"),
        task_tag::PollPendingModulesTask => {
            // Zig: `virtual_machine.modules.onPoll()`.
            todo!("dispatch: PollPendingModulesTask")
        }
        task_tag::RuntimeTranspilerStore => todo!("dispatch: RuntimeTranspilerStore"),

        // ── hot-reload (NOTE: Zig early-returns from the drain loop) ─────
        task_tag::HotReloadTask => todo!("dispatch: HotReloadTask"),
        task_tag::BakeHotReloadEvent => todo!("dispatch: BakeHotReloadEvent"),
        task_tag::FSWatchTask => todo!("dispatch: FSWatchTask"),

        // ── DNS ──────────────────────────────────────────────────────────
        task_tag::GetAddrInfoRequestTask => todo!("dispatch: GetAddrInfoRequestTask"),

        // ── node:fs async ops (`runFromJSThread`) ────────────────────────
        task_tag::Stat => todo!("dispatch: Stat"),
        task_tag::Lstat => todo!("dispatch: Lstat"),
        task_tag::Fstat => todo!("dispatch: Fstat"),
        task_tag::Open => todo!("dispatch: Open"),
        task_tag::ReadFile => todo!("dispatch: ReadFile"),
        task_tag::WriteFile => todo!("dispatch: WriteFile"),
        task_tag::CopyFile => todo!("dispatch: CopyFile"),
        task_tag::Read => todo!("dispatch: Read"),
        task_tag::Write => todo!("dispatch: Write"),
        task_tag::Truncate => todo!("dispatch: Truncate"),
        task_tag::Writev => todo!("dispatch: Writev"),
        task_tag::Readv => todo!("dispatch: Readv"),
        task_tag::Rename => todo!("dispatch: Rename"),
        task_tag::FTruncate => todo!("dispatch: FTruncate"),
        task_tag::Readdir => todo!("dispatch: Readdir"),
        task_tag::ReaddirRecursive => todo!("dispatch: ReaddirRecursive"),
        task_tag::Close => todo!("dispatch: Close"),
        task_tag::Rm => todo!("dispatch: Rm"),
        task_tag::Rmdir => todo!("dispatch: Rmdir"),
        task_tag::Chown => todo!("dispatch: Chown"),
        task_tag::FChown => todo!("dispatch: FChown"),
        task_tag::Utimes => todo!("dispatch: Utimes"),
        task_tag::Lutimes => todo!("dispatch: Lutimes"),
        task_tag::Chmod => todo!("dispatch: Chmod"),
        task_tag::Fchmod => todo!("dispatch: Fchmod"),
        task_tag::Link => todo!("dispatch: Link"),
        task_tag::Symlink => todo!("dispatch: Symlink"),
        task_tag::Readlink => todo!("dispatch: Readlink"),
        task_tag::Realpath => todo!("dispatch: Realpath"),
        task_tag::RealpathNonNative => todo!("dispatch: RealpathNonNative"),
        task_tag::Mkdir => todo!("dispatch: Mkdir"),
        task_tag::Fsync => todo!("dispatch: Fsync"),
        task_tag::Fdatasync => todo!("dispatch: Fdatasync"),
        task_tag::Access => todo!("dispatch: Access"),
        task_tag::AppendFile => todo!("dispatch: AppendFile"),
        task_tag::Mkdtemp => todo!("dispatch: Mkdtemp"),
        task_tag::Exists => todo!("dispatch: Exists"),
        task_tag::Futimes => todo!("dispatch: Futimes"),
        task_tag::Lchmod => todo!("dispatch: Lchmod"),
        task_tag::Lchown => todo!("dispatch: Lchown"),
        task_tag::Unlink => todo!("dispatch: Unlink"),
        task_tag::StatFS => todo!("dispatch: StatFS"),

        // ── compression streams ──────────────────────────────────────────
        task_tag::NativeZlib => todo!("dispatch: NativeZlib"),
        task_tag::NativeBrotli => todo!("dispatch: NativeBrotli"),
        task_tag::NativeZstd => todo!("dispatch: NativeZstd"),

        // ── process / signals ────────────────────────────────────────────
        task_tag::ProcessWaiterThreadTask => todo!("dispatch: ProcessWaiterThreadTask"),
        task_tag::PosixSignalTask => {
            // Zig: `PosixSignalTask.runFromJSThread(@intCast(task.asUintptr()), global)`
            // — `ptr` here is *not* a pointer but a packed signal number.
            todo!("dispatch: PosixSignalTask")
        }
        task_tag::NativePromiseContextDeferredDerefTask => {
            // Zig: `runFromJSThread(@intCast(task.asUintptr()))` — `ptr` packs an int.
            todo!("dispatch: NativePromiseContextDeferredDerefTask")
        }

        // ── server / bundler / streams ───────────────────────────────────
        task_tag::ServerAllConnectionsClosedTask => {
            todo!("dispatch: ServerAllConnectionsClosedTask")
        }
        task_tag::BundleV2DeferredBatchTask => todo!("dispatch: BundleV2DeferredBatchTask"),
        task_tag::FlushPendingFileSinkTask => todo!("dispatch: FlushPendingFileSinkTask"),
        task_tag::StreamPending => todo!("dispatch: StreamPending"),

        // ── timer wrappers (declared in the union but never dispatched
        //    here in Zig either — see Task.zig trailing `else`) ───────────
        task_tag::ImmediateObject | task_tag::TimeoutObject => {
            // Spec Task.zig:529-535: `bun.Output.panic("Unexpected Task tag: {d}")`.
            // This is a *reachable* producer bug (timer object enqueued as Task),
            // not provable-unreachable — `unreachable_unchecked()` here would be
            // release-build UB. PORTING.md §Dispatch only sanctions UB for the
            // truly-unreachable wildcard.
            panic!("Unexpected Task tag: {}", task.tag.0);
        }

        _ => {
            // Spec Task.zig:529-535: controlled `bun.Output.panic` with
            // diagnostic. A value outside `task_tag::COUNT` is a producer bug,
            // but the spec treats it as a recoverable crash, not UB.
            panic!("Unexpected Task tag: {}", task.tag.0);
        }
    }
}

/// Compile-time guard that the arm count above tracks
/// `bun_event_loop::task_tag::COUNT`. Bump when adding a variant.
const _: () = assert!(
    task_tag::COUNT == 96,
    "dispatch::run_task arm count out of sync with bun_event_loop::task_tag",
);

// ────────────────────────────────────────────────────────────────────────────
// `tick_queue_with_count` — the full drain loop (Zig `tickQueueWithCount`).
// Gated: `EventLoop` / `VirtualMachine` / `drain_microtasks_with_global` live
// in `bun_jsc`, which is not yet a dep of `bun_runtime` (Cargo.toml has it
// commented out under `TODO(b2-blocked)`).
// ────────────────────────────────────────────────────────────────────────────
// TODO(b2-blocked): bun_jsc::event_loop — un-gate once `bun_jsc` is a dep.

pub fn tick_queue_with_count(
    el: &mut bun_jsc::event_loop::EventLoop,
    vm: &mut bun_jsc::VirtualMachine,
    counter: &mut u32,
) -> Result<(), bun_jsc::event_loop::JsTerminated> {
    let global = el.global();
    let global_vm = global.vm();
    while let Some(task) = el.tasks.read_item() {
        // PORT NOTE: HotReloadTask is special-cased in Zig — it runs, then
        // *resets `counter` to 0 and returns early* so microtasks are NOT
        // drained. That control-flow can't be expressed via `run_task` alone;
        // when un-gating, either inline the HotReloadTask arm here or have
        // `run_task` return an enum { Continue, Return }.
        if task.tag == task_tag::HotReloadTask {
            todo!("dispatch: HotReloadTask early-return");
        }
        run_task(task);
        *counter += 1;
        el.drain_microtasks_with_global(global, global_vm)?;
    }
    el.tasks.reset_head_if_empty();
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// FilePoll dispatch (src/aio/posix_event_loop.zig `FilePoll.onUpdate` switch)
// ════════════════════════════════════════════════════════════════════════════

/// Hot-path dispatcher for `bun_aio::FilePoll::on_update`. Registered into
/// [`ON_POLL_DISPATCH`]; the low-tier `FilePoll` calls through that hook so it
/// never names `Subprocess` / `FileSink` / `DNSResolver` / etc.
///
/// # Safety
/// `poll` must point at a live [`FilePoll`] for the duration of the call
/// (guaranteed by `FilePoll::on_update`, the only caller).
pub unsafe fn run_file_poll(poll: *mut FilePoll, size_or_offset: i64) {
    // SAFETY: contract above.
    let poll = unsafe { &mut *poll };
    let owner = poll.owner;
    let hup = poll.flags.contains(PollFlag::Hup);

    debug_assert!(!owner.is_null());

    match owner.tag() {
        poll_tag::BUFFERED_READER => {
            // SAFETY: tag set with this pointee type at `FilePoll::init`.
            let reader = unsafe { &mut *(owner.ptr as *mut bun_io::BufferedReader) };
            bun_io::BufferedReader::on_poll(reader, size_or_offset as isize, hup);
        }
        poll_tag::PROCESS => {
            // SAFETY: tag set with this pointee type at `FilePoll::init`.
            let proc = unsafe { &mut *(owner.ptr as *mut crate::api::bun_process::Process) };
            // `Process::on_wait_pid_from_event_loop_task` is body-gated
            // (` impl Process`) pending the `bun_spawn` posix
            // wrappers; the cast above stays so the type wiring is exercised.
            // TODO(b2-blocked): crate::api::bun_process::Process::on_wait_pid_from_event_loop_task
            let _ = proc;
            todo!("dispatch: Process.on_wait_pid_from_event_loop_task")
        }
        poll_tag::PARENT_DEATH_WATCHDOG => {
            // SAFETY: tag set with this pointee type at `FilePoll::init`.
            let wd = unsafe {
                &mut *(owner.ptr as *mut bun_aio::parent_death_watchdog::ParentDeathWatchdog)
            };
            // Zig gates this `comptime !Environment.isMac => unreachable`;
            // mirror with a debug-assert (Linux uses prctl(PR_SET_PDEATHSIG)).
            #[cfg(target_os = "macos")]
            bun_aio::parent_death_watchdog::on_parent_exit(wd);
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "ParentDeathWatchdog poll on non-mac");
                let _ = wd;
            }
        }

        // ── gated payload types ──────────────────────────────────────────
        poll_tag::FILE_SINK => todo!("dispatch: FileSink.on_poll"),
        poll_tag::STATIC_PIPE_WRITER => todo!("dispatch: StaticPipeWriter.on_poll"),
        poll_tag::SHELL_STATIC_PIPE_WRITER => todo!("dispatch: ShellStaticPipeWriter.on_poll"),
        poll_tag::SECURITY_SCAN_STATIC_PIPE_WRITER => {
            todo!("dispatch: SecurityScanStaticPipeWriter.on_poll")
        }
        poll_tag::SHELL_BUFFERED_WRITER => todo!("dispatch: ShellBufferedWriter.on_poll"),
        poll_tag::DNS_RESOLVER => todo!("dispatch: DNSResolver.on_dns_poll"),
        poll_tag::GET_ADDR_INFO_REQUEST => {
            todo!("dispatch: GetAddrInfoRequest.on_machport_change")
        }
        poll_tag::REQUEST => todo!("dispatch: InternalDNSRequest.on_machport_change"),
        poll_tag::TERMINAL_POLL => todo!("dispatch: TerminalPoll.on_poll"),
        poll_tag::LIFECYCLE_SCRIPT_SUBPROCESS_OUTPUT_READER => {
            todo!("dispatch: LifecycleScriptSubprocessOutputReader.on_poll")
        }

        poll_tag::NULL | _ => {
            // Zig: `else => log("onUpdate ... disconnected? (maybe: {s})")`.
            // The low-tier `on_update` already logged before calling the hook
            // when it was null; here we just no-op the unknown tag.
            let _ = (size_or_offset, hup);
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Hook installation
// ════════════════════════════════════════════════════════════════════════════

/// `RUN_IMMEDIATE_HOOK` body — cast the opaque low-tier
/// `bun_jsc::event_loop::ImmediateObject` to the real
/// `crate::timer::ImmediateObject` and run the task.
///
/// # Safety
/// `task` was produced by `enqueue_immediate_task` from a live
/// `timer::ImmediateObject`; `vm` is the live per-thread VM.
unsafe fn run_immediate_task_hook(
    task: *mut bun_jsc::event_loop::ImmediateObject,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) -> bool {
    // SAFETY: per fn contract — the low-tier `ImmediateObject` is an opaque
    // forward-decl; the only producer (`TimerObjectInternals::init`) stores a
    // `*mut crate::timer::ImmediateObject`, so the cast is the identity.
    unsafe {
        crate::timer::ImmediateObject::run_immediate_task(
            task.cast::<crate::timer::ImmediateObject>(),
            vm,
        )
    }
}

/// `RUN_WTF_TIMER_HOOK` body — cast the opaque low-tier
/// `bun_jsc::event_loop::WTFTimer` to the real `crate::timer::WTFTimer` and
/// fire it (spec event_loop.zig:302-306 `imminent_gc_timer.swap(null).?.run(vm)`).
///
/// # Safety
/// `timer` was published by `WTFTimer::update` into `imminent_gc_timer` and
/// remains live until consumed; `vm` is the live per-thread VM.
unsafe fn run_wtf_timer_hook(
    timer: *mut bun_jsc::event_loop::WTFTimer,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) {
    // SAFETY: per fn contract — the low-tier `WTFTimer` is an opaque
    // forward-decl; the only producer (`WTFTimer::update`) stores a
    // `*mut crate::timer::WTFTimer`, so the cast is the identity.
    let real = timer.cast::<crate::timer::WTFTimer>();
    // SAFETY: per fn contract — `real` is live until consumed; `vm` is the
    // per-thread VM. `run` may re-enter `(*runtime_state()).timer.remove()`;
    // no `&mut` held here.
    unsafe { crate::timer::WTFTimer::run(real, vm) }
}

// ════════════════════════════════════════════════════════════════════════════
// EventLoopTimer dispatch (src/event_loop/EventLoopTimer.zig `fire` switch)
// ════════════════════════════════════════════════════════════════════════════

/// `FIRE_TIMER` body — the tag→`@fieldParentPtr` match for
/// [`EventLoopTimer::fire`]. Spec EventLoopTimer.zig:170-223.
///
/// Reached from [`crate::timer::All::drain_timers`] (every due heap timer) and
/// [`crate::timer::All::get_timeout`] (WTFTimer side-effect). Without this hook
/// registered, the low-tier `fire()` transmutes a null fn-ptr in release
/// builds (debug-asserts in debug) — i.e. `setTimeout`/`setInterval` callbacks
/// never fire.
///
/// Arms whose container type is still ``-gated in this crate are
/// `todo!("dispatch: …")` placeholders so the table stays exhaustive against
/// `EventLoopTimerTag`; un-gating a type means swapping its arm body in-place.
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] just popped from `All.timers`;
/// `now` is the snapshot taken by `All::next`; `vm` is the erased
/// `*mut VirtualMachine`. The handler may free the container — do not touch
/// `t` after the per-arm call returns.
unsafe fn fire_timer(t: *mut EventLoopTimer, now: *const ElTimespec, vm: *mut ()) {
    use core::mem::offset_of;
    use crate::timer::{ImmediateObject, TimeoutObject, WTFTimer};

    /// `@fieldParentPtr("$field", t)` — recover the embedding container.
    macro_rules! container_of {
        ($ty:ty, $field:ident) => {{
            // SAFETY: §Dispatch — `t.tag` was set together with the container
            // at construction; tag uniquely identifies the embedding type and
            // `$field` is the `EventLoopTimer` slot `t` points into.
            unsafe { (t as *mut u8).sub(offset_of!($ty, $field)).cast::<$ty>() }
        }};
    }

    // SAFETY: per fn contract — `t` is live for the dispatch read.
    let tag = unsafe { (*t).tag };
    let vm = vm.cast::<crate::jsc::virtual_machine::VirtualMachine>();
    let _ = now;
    match tag {
        // ── JS-exposed timers (TimerObjectInternals::fire) ───────────────
        EventLoopTimerTag::TimeoutObject => {
            let container = container_of!(TimeoutObject, event_loop_timer);
            // SAFETY: container derived from a live `TimeoutObject`; do NOT
            // form `&mut *container` — `internals.fire` may `deref()` and free.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // TODO(b2-blocked): `TimerObjectInternals::fire` body lives in the
            // gated `TimerObjectInternals.rs` Phase-A draft (the un-gated
            // `timer_object_internals.rs` only carries `run_immediate_task`).
            // Un-gate the call below once `fire()` is moved over.
            
            // SAFETY: per fn contract — `now` is the live snapshot; `vm` is the
            // per-thread VM. `fire` may free the container; `t` is dead after.
            return unsafe { (*internals).fire(&*now, vm) };
            let _ = (internals, vm);
            todo!("dispatch: TimerObjectInternals::fire")
        }
        EventLoopTimerTag::ImmediateObject => {
            let container = container_of!(ImmediateObject, event_loop_timer);
            // SAFETY: see TimeoutObject arm.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // TODO(b2-blocked): `TimerObjectInternals::fire` — gated draft.
            
            // SAFETY: see TimeoutObject arm.
            return unsafe { (*internals).fire(&*now, vm) };
            let _ = (internals, vm);
            todo!("dispatch: TimerObjectInternals::fire")
        }
        EventLoopTimerTag::TimerCallback => {
            let container = container_of!(TimerCallback, event_loop_timer);
            // SAFETY: container derived from a live `TimerCallback`; the
            // callback fn-ptr was set together with the tag at construction.
            // Spec `inline else` fallthrough: `container.callback(container)`.
            unsafe { ((*container).callback)(container) };
        }
        EventLoopTimerTag::WTFTimer => {
            let container = container_of!(WTFTimer, event_loop_timer);
            // SAFETY: container derived from a live `WTFTimer`; `now` is the
            // snapshot from `All::next`; `vm` is the per-thread VM. `fire` may
            // re-enter `(*runtime_state()).timer` — no `&mut` held here.
            unsafe { WTFTimer::fire(container, &*now, vm) };
        }
        EventLoopTimerTag::AbortSignalTimeout => {
            // TODO(b2-blocked): `bun_jsc::abort_signal::Timeout::run` — gated module.
            todo!("dispatch: AbortSignal.Timeout::run")
        }
        EventLoopTimerTag::DateHeaderTimer => {
            // TODO(b2-blocked): `crate::timer::DateHeaderTimer::run` — gated draft.
            todo!("dispatch: DateHeaderTimer::run")
        }
        EventLoopTimerTag::EventLoopDelayMonitor => {
            // TODO(b2-blocked): `crate::timer::EventLoopDelayMonitor::on_fire` — gated draft.
            todo!("dispatch: EventLoopDelayMonitor::on_fire")
        }
        EventLoopTimerTag::StatWatcherScheduler => todo!("dispatch: StatWatcherScheduler::timerCallback"),
        EventLoopTimerTag::UpgradedDuplex => todo!("dispatch: UpgradedDuplex::onTimeout"),
        EventLoopTimerTag::DNSResolver => todo!("dispatch: DNSResolver::checkTimeouts"),
        EventLoopTimerTag::WindowsNamedPipe => {
            #[cfg(windows)]
            todo!("dispatch: WindowsNamedPipe::onTimeout");
            #[cfg(not(windows))]
            {
                // Spec: `UnreachableTimer` on non-Windows.
                if cfg!(debug_assertions) {
                    unreachable!("WindowsNamedPipe timer on non-Windows");
                }
            }
        }
        EventLoopTimerTag::PostgresSQLConnectionTimeout => {
            todo!("dispatch: PostgresSQLConnection::onConnectionTimeout")
        }
        EventLoopTimerTag::PostgresSQLConnectionMaxLifetime => {
            todo!("dispatch: PostgresSQLConnection::onMaxLifetimeTimeout")
        }
        EventLoopTimerTag::MySQLConnectionTimeout => {
            todo!("dispatch: MySQLConnection::onConnectionTimeout")
        }
        EventLoopTimerTag::MySQLConnectionMaxLifetime => {
            todo!("dispatch: MySQLConnection::onMaxLifetimeTimeout")
        }
        EventLoopTimerTag::ValkeyConnectionTimeout => {
            todo!("dispatch: Valkey::onConnectionTimeout")
        }
        EventLoopTimerTag::ValkeyConnectionReconnect => {
            todo!("dispatch: Valkey::onReconnectTimer")
        }
        EventLoopTimerTag::SubprocessTimeout => todo!("dispatch: Subprocess::timeoutCallback"),
        EventLoopTimerTag::DevServerSweepSourceMaps => {
            todo!("dispatch: DevServer.SourceMapStore::sweepWeakRefs")
        }
        EventLoopTimerTag::DevServerMemoryVisualizerTick => {
            todo!("dispatch: DevServer::emitMemoryVisualizerMessageTimer")
        }
        EventLoopTimerTag::BunTest => todo!("dispatch: BunTest::bunTestTimeoutCallback"),
        EventLoopTimerTag::CronJob => todo!("dispatch: CronJob::onTimerFire"),
    }
}

/// `JS_TIMER_EPOCH` body — the tag→`@fieldParentPtr` read for
/// [`EventLoopTimer::js_timer_epoch`]. Spec EventLoopTimer.zig
/// `jsTimerInternalsFlags` (returns `internals.flags.epoch` for the three
/// JS-timer container types, else null). Sits on the heap-compare hot path
/// (`EventLoopTimer::less` → `TimerHeap` meld), so without this hook
/// equal-deadline JS timers lose their stable insertion order.
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] currently linked into a `TimerHeap`.
unsafe fn js_timer_epoch(tag: EventLoopTimerTag, t: *const EventLoopTimer) -> Option<u32> {
    use core::mem::offset_of;
    use crate::timer::{AbortSignalTimeout, ImmediateObject, TimeoutObject};
    // SAFETY: tag invariant — when `tag` matches, `t` is the `event_loop_timer`
    // field of the named container (set at construction; never re-tagged).
    match tag {
        EventLoopTimerTag::TimeoutObject => unsafe {
            let parent = (t as *const u8)
                .sub(offset_of!(TimeoutObject, event_loop_timer))
                .cast::<TimeoutObject>();
            Some((*parent).internals.flags.epoch())
        },
        EventLoopTimerTag::ImmediateObject => unsafe {
            let parent = (t as *const u8)
                .sub(offset_of!(ImmediateObject, event_loop_timer))
                .cast::<ImmediateObject>();
            Some((*parent).internals.flags.epoch())
        },
        EventLoopTimerTag::AbortSignalTimeout => unsafe {
            let parent = (t as *const u8)
                .sub(offset_of!(AbortSignalTimeout, event_loop_timer))
                .cast::<AbortSignalTimeout>();
            Some((*parent).flags.epoch())
        },
        _ => None,
    }
}

/// Wire the high-tier dispatchers into the low-tier hooks. Called once from
/// `main.rs` before the first event-loop tick.
pub fn install_dispatch_hooks() {
    // FilePoll::on_update → run_file_poll (real — `bun_aio` is a dep).
    ON_POLL_DISPATCH.store(
        run_file_poll as unsafe fn(*mut FilePoll, i64) as *mut (),
        Ordering::Release,
    );

    // EventLoop::tick_immediate_tasks → ImmediateObject::run_immediate_task.
    bun_jsc::event_loop::set_run_immediate_hook(run_immediate_task_hook);

    // EventLoop::run_imminent_gc_timer → WTFTimer::run.
    bun_jsc::event_loop::set_run_wtf_timer_hook(run_wtf_timer_hook);

    // EventLoopTimer::fire → fire_timer (tag→@fieldParentPtr match).
    FIRE_TIMER.store(
        fire_timer as unsafe fn(*mut EventLoopTimer, *const ElTimespec, *mut ()) as *mut (),
        Ordering::Release,
    );

    // EventLoopTimer::less → js_timer_epoch (heap-compare stable-order hook).
    JS_TIMER_EPOCH.store(
        js_timer_epoch as unsafe fn(EventLoopTimerTag, *const EventLoopTimer) -> Option<u32>
            as *mut (),
        Ordering::Release,
    );

    // bun_jsc::RUN_TASK_HOOK / TICK_QUEUE_HOOK → tick_queue_with_count.
    // Gated: `tick_queue_with_count` itself is `` above (its
    // `HotReloadTask` early-return needs the high-tier type un-gated).
    // TODO(b2-blocked): bun_jsc::set_run_task_hook / set_tick_queue_hook.
    
    {
        bun_jsc::set_run_task_hook(tick_queue_with_count);
        bun_jsc::event_loop::set_tick_queue_hook(tick_queue_with_count);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Task.zig tickQueueWithCount (96-arm switch) +
//               src/aio/posix_event_loop.zig FilePoll.onUpdate (13-arm switch)
//   confidence: medium — table exhaustive, arm bodies mostly gated
//   todos:      see `todo!("dispatch: …")` count; un-gate per-type as the
//               owning module loses its ``
//   notes:      §Dispatch hot-path — high tier owns the match; low tier
//               stores (tag, ptr) + AtomicPtr hook only.
// ──────────────────────────────────────────────────────────────────────────
