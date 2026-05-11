# Domain-Owned `_types` Split

Status: production-shaped branch. The IO dispatch boundary is wired through a
domain-owned `bun_io_types` crate; the same rule is the target for the remaining
process-exit, installer, runtime-task, and reader dispatch families.

The rule is simple: low/shared crates own inert shape, high/owning crates apply
effects.

```
Domain-owned `_types` architecture
  ├─> shared type crates own shape
  │     ├─> closed discriminants
  │     ├─> marker types for erased owner slots
  │     ├─> typed owner tokens around pointer identity
  │     ├─> kernel-facing packed tokens where the OS requires a scalar
  │     └─> pure transition state when a subsystem has value-only reducers
  └─> owning crates apply effects
        ├─> JSC / VM entry, promise resolution, and microtask drains
        ├─> process status writes, ref changes, kills, and platform handles
        ├─> FilePoll / kqueue / epoll registration and deregistration
        ├─> package-manager callbacks, lifecycle bookkeeping, and scanner output
        └─> C++ / WebKit opaque work execution
```

## Crate Topology

```
Dependency DAG
  ├─> bun_spawn_types
  │     └─> base process values: Status / Exited / WaitPidResult / Rusage / ProcessIdentity
  ├─> domain sidecar types
  │     ├─> bun_install_types
  │     │     ├─> depends on bun_spawn_types
  │     │     └─> owns lifecycle/security process-output state and action enums
  │     ├─> bun_runtime_types
  │     │     ├─> depends on bun_spawn_types, plus bun_jsc_types for inert JSC pointer handles
  │     │     └─> owns runtime-domain process/task state, not JSC effects or drop-owning handles
  │     ├─> bun_jsc_types
  │     │     ├─> depends on no higher crates
  │     │     └─> owns inert JSC handle shapes that can be named below bun_jsc
  │     └─> bun_shell_types / CLI sidecars, if introduced
  │           ├─> depend on bun_spawn_types
  │           └─> own shell/CLI process state visible below the effect crates
  ├─> lower implementation crates
  │     ├─> bun_spawn
  │     │     ├─> depends on bun_spawn_types + domain sidecars whose targets it stores
  │     │     ├─> owns process wait/reap/status/lifetime mechanics
  │     │     └─> does not depend on bun_install or bun_runtime effect crates
  │     ├─> bun_io
  │     │     ├─> depends on bun_io_types + domain sidecars needed for reader/poll state
  │     │     └─> owns kernel/FilePoll/BufferedReader mechanics
  │     └─> bun_event_loop
  │           ├─> depends on task/payload sidecars
  │           └─> owns queue/wakeup mechanics
  └─> effect crates
        ├─> bun_install
        │     ├─> depends on bun_spawn + bun_install_types
        │     └─> applies PackageManager/lifecycle/security effects
        └─> bun_runtime / shell / CLI modules
              ├─> depend on bun_spawn + their sidecar types
              └─> apply JSC, shell, webview, cron, and C++ effects
```

The important dependency is that `bun_spawn` may know about
`bun_install_types::LifecycleScript...` or a runtime/shell sidecar type, but it
must not know about `bun_install::LifecycleScriptSubprocess` or
`bun_runtime::Subprocess`. If a lower crate still needs an effect owner, not
enough of that owner has moved into sidecar types.

```
Natural sibling crates
  ├─> bun_io_types
  │     ├─> heap
  │     │     - allocation-free intrusive heap metadata shared by IO, timers, and lifecycle-type state
  │     ├─> owner::OwnerToken<T>
  │     │     - non-zero typed pointer identity
  │     ├─> reader::BufferedReaderHandle
  │     │     - non-zero typed lower-reader identity for typed reader targets
  │     ├─> pollable::Token
  │     │     - preserves the epoll/kqueue u64 packing boundary
  │     └─> file_poll
  │           ├─> Kind
  │           ├─> Owner enum
  │           │     - closed variants such as Process(OwnerToken<Process>)
  │           │     - no safe stored `{ kind, addr }` pairing
  │           └─> marker variants such as Process, FileSink, BufferedReader, DnsResolver
  ├─> bun_spawn_types
  │     ├─> Status / Exited / WaitPidResult / Rusage
  │     ├─> ProcessIdentity
  │     ├─> ProcessExitContext
  │     └─> ProcessExitReadiness
  ├─> bun_jsc_types
  │     ├─> GlobalRef<T>
  │     │     └─> copyable VM-lifetime pointer wrapper; bun_jsc aliases it as GlobalRef<JSGlobalObject>
  │     ├─> StrongRefSlot
  │     │     └─> opaque strong-reference slot storage identity
  │     └─> StrongRefHandle
  │           ├─> non-null slot handle; allocation, mutation, clear, and drop stay in bun_jsc::strong
  │           ├─> OptionalStrongRefHandle is the nullable slot shape behind jsc.Strong.Optional
  │           └─> JSPromiseStrongHandle is the nullable promise-root slot shape behind JSPromiseStrong
  ├─> bun_install_types
  │     ├─> LifecycleScriptExit
  │     ├─> LifecycleScriptState
  │     │     └─> lifecycle command list, copied package name, current index, output readiness, timer, install context, and exit reducer
  │     ├─> ScriptsList
  │     │     └─> lifecycle command list data formerly owned in bun_install::lockfile::package::scripts
  │     ├─> InstallerHandle / InstallCtx
  │     │     └─> typed install-task identity needed by lifecycle completion effects
  │     └─> SecurityScanExit
  ├─> bun_runtime_types
  │     ├─> cron_parser::CronExpression / CronError
  │     │     └─> pure cron expression parse/state; JSC date conversion stays in bun_runtime
  │     └─> cron / subprocess / shell / reader state
  │           └─> runtime-domain process/task/readiness shape, including inert GlobalRef<()> where a job only needs VM pointer identity below bun_runtime
  └─> owning crates
        ├─> bun_io stores IO owner/token values and owns kernel registration
        ├─> bun_spawn owns process wait state and process lifetime
        ├─> bun_install owns package-manager lifecycle/security effects
        └─> bun_runtime owns JSC, shell, webcore, DNS, cron, and runtime task effects
```

## IO Dispatch

FilePoll has a Bun-owned pointer relationship; Pollable has a kernel scalar
relationship. They therefore use two related but distinct shapes in
`bun_io_types`.

```
FilePoll production path
  ├─> producers
  │     ├─> bun_spawn::Process
  │     ├─> bun_io::BufferedReader / pipe writers
  │     ├─> runtime FileSink / Terminal / shell writers / subprocess writers
  │     ├─> install SecurityScanSubprocess writer
  │     ├─> runtime DNS resolver and macOS DNS request polls
  │     └─> ParentDeathWatchdog
  ├─> construction
  │     ├─> direct producers call Owner::typed::<file_poll::Variant>(ptr)
  │     └─> generic writer parents expose type PollOwner: file_poll::Variant
  ├─> storage
  │     └─> bun_io::FilePoll stores bun_io_types::file_poll::Owner as a closed typed enum
  └─> consumer
        └─> bun_runtime::dispatch::__bun_run_file_poll
              ├─> matches owner.kind()
              ├─> recovers owner.ptr() in the one runtime dispatch site
              └─> calls the concrete handler for that closed owner kind
```

The important detail is that writer families no longer thread a raw
`PollTag` constant, and the stored owner is no longer a safe `kind + addr`
struct. A producer declares the owner marker type instead:

```rust
impl bun_io::pipe_writer::PosixStreamingWriterParent for FileSink {
    type PollOwner = bun_io_types::file_poll::FileSink;

    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        FileSink::on_write(unsafe { &mut *this }, amount, status)
    }
}
```

The generic writer code then constructs the correct owner without knowing which
higher crate supplied the parent:

```rust
FilePollRef::init(
    loop_,
    fd,
    Owner::typed::<Parent::PollOwner>(std::ptr::from_mut(self).cast()),
)
```

`Owner::from_raw_parts(kind, ptr)` remains only as an unsafe escape hatch for
raw ABI edges. Normal producers call `Owner::typed::<Variant>(ptr)`, which
builds the enum variant and ties the owner token to the marker type in the
type crate.

Pollable remains scalar because that is the kernel ABI:

```
Pollable production path
  ├─> producer: bun_io::Poll::register_for_epoll / apply_kqueue
  │     └─> Pollable::init(tag, poll) encodes through bun_io_types::pollable::Token
  ├─> kernel boundary
  │     └─> epoll_event.data.u64 / kevent.udata carries the packed token
  └─> consumer: bun_io::IoRequestLoop::tick_epoll / Poll::on_update_kqueue
        ├─> Pollable::from(raw) wraps the same Token
        ├─> Pollable::tag() recovers pollable::Kind
        └─> Pollable::poll() recovers the embedded Poll pointer for runtime dispatch
```

## Process Exit

Process exit uses the same boundary for install-domain readiness gates and
runtime process completion: value-only state lives below, effect application
stays above.

This branch proves seven process-exit production paths, three runtime reader
paths, and two install reader paths, plus one Mini-shell hard-case slice.
WebView process exits use the
runtime sidecar path: `bun_spawn` stores a `RuntimeProcessExitTarget`, emits a
`RuntimeProcessExitAction`, and `bun_runtime::dispatch` applies the Chrome/Host
effects. Security scanner exits use the install sidecar path: `bun_spawn` stores
an `InstallProcessExitTarget::SecurityScan(SecurityScanExitHandle)` and only
marks typed install state. Security scanner IPC reader callbacks also record
through `bun_io::BufferedReaderTarget::Install { target:
InstallBufferedReaderTarget::SecurityScanIpc, ... }`, so the reader side no
longer asks `bun_io` to call back into `SecurityScanSubprocess*`; the typed
handle hides the state pointer inside `bun_install_types`, and `bun_install`
still owns the local drain/deinit and result parsing effects before it reports
the scanner done. The Windows
sync-spawn path is a local spawn-internal
case: `SyncWindowsProcess` is not a cross-crate owner, so it now uses a local
`ProcessExitTarget::SyncWindows` arm inside `bun_spawn`. `bun run --filter` and
`bun run --parallel` use runtime sidecar targets keyed by their existing handle
slots; `bun_runtime::dispatch` consumes the typed action and synchronously
re-enters the current `MiniEventLoop` context. Parallel test workers use the
same runtime sidecar action pattern with the JS event loop: the target stores
only the worker slot index, and `run_as_coordinator` exposes its stack-owned
`Coordinator` as the current JS-loop driver context while `coord.drive()` runs.
Shell subprocesses use the same idea with shell arena identity: `bun_spawn`
stores `RuntimeProcessExitTarget::ShellCommand { command: NodeId,
interpreter: Option<InterpreterHandle> }`. The standalone-shell driver exposes
the live `Interpreter` as the Mini tick context, while the JS-shell path stores
a sidecar-owned `InterpreterHandle` because one JS event loop may host multiple
live interpreters. Runtime dispatch calls back into the command arena by
`NodeId` without storing `ShellSubprocess*` or a `CmdHandle` in the process.
Installer sleeps now use the same current-context shape without changing their
closure callback context: `PackageManager::sleep_until` keeps its erased
`is_done` closure as the Mini/JS task context, while exposing `PackageManager*`
as the event-loop current context during tick bodies. That removes the previous
ambiguity where the event-loop context could be an arbitrary local closure
slot, but it still only identifies the manager, not the exact lifecycle
subprocess.

Lifecycle scripts now also keep their pure command/readiness state in
`bun_install_types::lifecycle::LifecycleScriptState`: script list, copied
package name, current script index, output-fd readiness, timer, alive-count
state, install-task context, lower `ProcessHandle`, stdout/stderr
`BufferedReaderHandle`s, and the `LifecycleScriptExit` reducer. The production
spawn path records those lower handles in the sidecar state and installs
`ProcessExitTarget::Install(InstallProcessExitTarget::LifecycleScript(...))`.
`bun_spawn` stores only a `LifecycleScriptStateHandle`, feeds
`LifecycleScriptExit`, and emits an install-domain action when the reducer says
the owning script may be ready. `bun_install` keeps the effectful owner side:
it drains ready nodes from the existing `PackageManager.active_lifecycle_scripts`
heap, then the normal lifecycle code prints output, updates progress, starts the
next script, completes installer entries, or frees the subprocess. Lifecycle
stdout/stderr readers now use `BufferedReaderTarget::Install` with
`InstallBufferedReaderTarget::LifecycleScriptOutput { state }`: `bun_io`
records reader done/error into the same `LifecycleScriptStateHandle`, emits a
typed install-reader delivery when the reducer may be ready, and
`bun_runtime::dispatch` re-enters `bun_install` through the current
`PackageManager*` context to drain the existing active lifecycle heap. Reader
errors still print the same script/package/errno message from `bun_install`,
with the lower IO crate passing only typed error data. The install context
stores the entry id plus a typed installer handle; the concrete `Installer<'_>`
pointer is recovered only at the `bun_install` effect sites. Cron
register/remove now keep their OS-cron job state in `bun_runtime_types::cron`:
phase, title/path/schedule/tmp-path data, parsed expression, the inert
`GlobalRef<()>` VM pointer, child-process readiness/error state, pending
output-fd count, lower `ProcessHandle`, stdout/stderr `BufferedReaderHandle`s,
initialized `ProcessExitReadiness`, and the first process-output error. The
production cron spawn path records those handles, and the current owner
callback validates process exit through the sidecar-owned `ProcessHandle`
before feeding `ProcessExitReadiness`. Once output and process status are
ready, `CronRegisterJobState::on_ready_process_status` /
`CronRemoveJobState::on_ready_process_status` decide whether the owner should
finish or advance and record the same first error bytes/messages as the old
runtime match. `bun_runtime` still performs the effects: detach/deref the
process, inspect/drain the runtime readers, cast the inert global pointer back
at the effect site, resolve/reject the promise, spawn the next OS command,
unlink temp paths, and free the job. Their exact job/effect owner still needs
to move before
`ProcessExitKind::{CronRegister,CronRemove}` can disappear.

`Bun.spawn` subprocesses now also carry their lower child-process identities in
`bun_runtime_types::subprocess::SubprocessExitState`: lower `ProcessHandle`,
stdout `BufferedReaderHandle`, stderr `BufferedReaderHandle`, and the cached
`Rusage` snapshot used by `resourceUsage()`. The generated spawn binding
records those handles after the process/readers are created, and the current
owner callback validates process exit through the sidecar-owned `ProcessHandle`
before recording the exit rusage and running the existing JS wrapper effects.
The Windows live `uv_getrusage` fallback also fills the same sidecar cache.
This is still not enough to remove `ProcessExitKind::Subprocess`; the wrapper
owns the JSC refs, stdio wrappers, IPC, abort/timer, terminal, auto-killer
cleanup, and self deref edges that have to move or be named through a typed
runtime effect boundary. `GlobalRef<T>` has been moved into `bun_jsc_types`
because it is only a copyable raw VM-lifetime pointer wrapper; `StrongRefSlot`,
`StrongRefHandle`, and `OptionalStrongRefHandle` have also moved into
`bun_jsc_types` as the opaque slot identity plus non-null/nullable handle
shapes. `JSPromiseStrongHandle` now lives there too as the semantic nullable
promise-root handle shape. `bun_jsc` now aliases `GlobalRef<JSGlobalObject>`,
`bun_jsc::strong::Impl`, `bun_jsc::strong::Handle`, and
`bun_jsc::strong::OptionalHandle` so existing effect code keeps the same API
shape while `bun_jsc::strong::{Strong, Optional}` still own allocation,
mutation, clearing, and destruction of those slots. `JSPromiseStrong` now
stores the sidecar handle but still owns promise reads, resolution/rejection
entry points, clearing, and destruction in `bun_jsc`; `JsRef` and
`Strong::Optional` likewise still carry drop/effect semantics.
Moving the full `Subprocess`/cron job owner below `bun_runtime`
is therefore not a matter of copying a few pointer-sized fields into
`bun_runtime_types`; the remaining drop-owning JSC wrappers and runtime
resources still need real sidecar state/effect splits, with effectful promise
operations applied by `bun_runtime`. The JS shell path has the same interpreter-identity issue that
Mini avoids with tick context: a JS event loop can have multiple live shell
interpreters, so it carries an explicit sidecar-owned `InterpreterHandle`
alongside the `NodeId` instead of relying on a single loop `current_context`.

```
Process-exit production shape
  ├─> bun_spawn_types
  │     ├─> ProcessIdentity
  │     ├─> ProcessHandle
  │     ├─> ProcessExitContext { process, process_handle, status, rusage }
  │     ├─> ProcessExitReadiness
  │     │     └─> returns ProcessExitReadinessAction
  │     └─> common process status / rusage values
  ├─> bun_install_types
  │     ├─> LifecycleScriptExit
  │     │     └─> returns LifecycleScriptExitAction
  │     ├─> LifecycleScriptStateHandle
  │     │     └─> safe handle around lifecycle-domain state; no LifecycleScriptSubprocess pointer in bun_spawn
  │     ├─> LifecycleScriptState
  │     │     └─> owns pure lifecycle command/readiness/timer/install-task state while bun_install keeps effects
  │     ├─> InstallerHandle / InstallCtx
  │     │     └─> carries typed installer identity without making bun_spawn depend on bun_install
  │     └─> SecurityScanExit
  │           └─> returns SecurityScanExitAction
  ├─> bun_runtime_types
  │     ├─> RuntimeProcessExitTarget
  │     │     ├─> ChromeProcess / HostProcess
  │     │     ├─> FilterRunHandle / MultiRunHandle / TestParallelWorker slot indices
  │     │     └─> ShellCommand { command: NodeId } for Mini shell subprocesses
  │     ├─> RuntimeProcessExitAction
  │     │     └─> carries process identity + status + target data
  │     └─> shell::NodeId
  │           └─> sidecar-owned command identity for the shell arena
  ├─> bun_runtime_types::cron
  │     ├─> CronRegisterJobState / CronRemoveJobState
  │     │     └─> sidecar-owned OS-cron data: phase, title/path/schedule/tmp path, parsed expression, process reducer
  │     ├─> CronRegisterState
  │     ├─> CronRemoveState
  │     │     └─> sidecar-owned cron state-machine discriminants; JSC promise effects stay in bun_runtime
  │     ├─> CronProcessCompletion
  │     │     └─> Pending / Finish / Advance result from ready child status policy
  │     ├─> cron_parser::CronExpression
  │     │     └─> parsed schedule bitsets; next-occurrence JSC wall-clock conversion stays in bun_runtime
  │     └─> ProcessState
  │           └─> child-process readiness/error state shared below bun_runtime
  ├─> bun_runtime_types::subprocess
  │     └─> SubprocessExitState
  │           └─> lower ProcessHandle, stdout/stderr BufferedReaderHandle, and cached Rusage; JS wrapper effects stay in bun_runtime
  └─> owning crates
        ├─> bun_spawn observes waitpid / platform wait completion
        ├─> bun_install applies lifecycle/security package-manager effects
        └─> bun_runtime applies webview/cron/runtime effects
```

The type-level transition receives values, mutates only its own state, and
returns an action:

```rust
pub struct ProcessExitContext<'a> {
    pub process: ProcessIdentity,
    pub process_handle: Option<ProcessHandle>,
    pub status: Status,
    pub rusage: &'a Rusage,
}

pub struct ProcessExitReadiness {
    pub process: ProcessIdentity,
    pub has_process_exited: bool,
    pub exit_status: Option<Status>,
    pub remaining_fds: i8,
}

pub enum ProcessExitReadinessAction {
    WrongProcess,
    Pending,
    Ready,
}

pub struct LifecycleScriptExit {
    pub process: ProcessIdentity,
    pub has_called_process_exit: bool,
    pub exit_status: Option<Status>,
    pub remaining_fds: i8,
}

pub enum LifecycleScriptExitAction {
    WrongProcess,
    Pending,
    MaybeFinished,
}

pub struct SecurityScanExit {
    pub process: ProcessIdentity,
    pub has_process_exited: bool,
    pub has_received_ipc: bool,
    pub pending_ipc_reader_close: bool,
    pub remaining_fds: i8,
    pub exit_status: Option<Status>,
    pub ipc_data: Vec<u8>,
}

pub struct SecurityScanExitHandle(/* private */);

pub struct LifecycleScriptStateHandle(/* private */);

pub enum InstallProcessExitTarget {
    LifecycleScript(LifecycleScriptStateHandle),
    SecurityScan(SecurityScanExitHandle),
}

pub enum InstallProcessExitAction {
    LifecycleScript(LifecycleScriptExitAction),
    SecurityScan(SecurityScanExitAction),
}

pub enum InstallBufferedReaderTarget {
    SecurityScanIpc { state: SecurityScanExitHandle },
    LifecycleScriptOutput { state: LifecycleScriptStateHandle },
}

pub enum InstallBufferedReaderDelivery {
    LifecycleScriptOutput {
        state: LifecycleScriptStateHandle,
        action: LifecycleScriptExitAction,
        error: Option<InstallReaderError>,
    },
}

pub enum SecurityScanExitAction {
    WrongProcess,
    Pending { close_ipc_reader: bool },
    Ready { close_ipc_reader: bool },
}
```

```
Process-exit production wiring
  ├─> install/PackageManager/security_scanner.rs
  │     ├─> initializes SecurityScanExit with ipc_reader + json_writer count
  │     ├─> creates SecurityScanExitHandle once, at the owner setup point
  │     ├─> installs ProcessExitTarget::Install(SecurityScan(exit_handle))
  │     ├─> installs BufferedReaderTarget::Install(InstallBufferedReaderTarget::SecurityScanIpc { state: exit_handle }, event_loop)
  │     ├─> IPC reader chunks append into SecurityScanExit::ipc_data
  │     ├─> JSON writer close calls record_json_writer_closed()
  │     ├─> IPC reader done/error calls record_ipc_done() in bun_io
  │     ├─> bun_spawn process exit calls SecurityScanExit::on_process_exit()
  │     └─> is_done() drains/deinits a pending IPC reader close in bun_install before completion
  ├─> runtime/webview/ChromeProcess.rs and HostProcess.rs
  │     ├─> install ProcessExitTarget::Runtime(ChromeProcess | HostProcess)
  │     ├─> bun_spawn emits RuntimeProcessExitAction with ProcessIdentity + Status
  │     └─> bun_runtime::dispatch asks the runtime singleton owner to apply the effect
  ├─> runtime/cli/filter_run.rs and multi_run.rs
  │     ├─> store stable handle-slot indices in RuntimeProcessExitTarget
  │     ├─> bun_spawn emits RuntimeProcessExitAction with index + ProcessIdentity + Status
  │     ├─> FilePoll exits recover the active MiniEventLoop tick context
  │     ├─> waiter-thread Mini tasks pass their task context to the same typed delivery dispatcher
  │     └─> bun_runtime::dispatch indexes the existing State.handles slice and calls State::process_exit
  ├─> runtime/cli/test/parallel/runner.rs and Worker.rs
  │     ├─> run_as_coordinator sets JS EventLoop.current_context to the active Coordinator only around coord.drive()
  │     ├─> Worker installs ProcessExitTarget::Runtime(TestParallelWorker { index })
  │     ├─> bun_spawn emits RuntimeProcessExitAction with index + ProcessIdentity + Status
  │     └─> bun_runtime::dispatch indexes the existing Coordinator.workers slice and calls on_worker_exit synchronously
  ├─> event_loop/AnyEventLoop.rs and jsc/event_loop.rs
  │     ├─> MiniEventLoop already exposed the tick context while draining tasks and file polls
  │     ├─> the JS AnyEventLoop arm now sets/restores EventLoop.current_context around tick work too
  │     ├─> AnyEventLoop::tick_raw_with_current_context separates is_done/task context from current typed context
  │     └─> runtime dispatch can rely on the same typed current-context boundary for JS and Mini drivers
  ├─> install/PackageManager.rs
  │     ├─> sleep_until keeps the local closure pointer as the is_done/task context
  │     ├─> exposes PackageManager* as the event-loop current context while tick work runs
  │     └─> does not by itself identify which LifecycleScriptSubprocess completed
  ├─> runtime/shell/interpreter.rs and subproc.rs
  │     ├─> standalone shell passes the live Interpreter as MiniEventLoop tick context
  │     ├─> Mini shell subprocesses install RuntimeProcessExitTarget::ShellCommand { command: NodeId, interpreter: None }
  │     ├─> JS shell subprocesses install RuntimeProcessExitTarget::ShellCommand { command: NodeId, interpreter: Some(InterpreterHandle) }
  │     ├─> bun_spawn emits RuntimeProcessExitAction::ShellCommand with NodeId + optional InterpreterHandle + ProcessIdentity + Status
  │     ├─> direct wait/immediate-exit paths dispatch the same typed delivery with the known interpreter context
  │     └─> neither path stores ShellSubprocess* or CmdHandle in bun_spawn
  └─> spawn/process.rs sync Windows path
        ├─> stores ProcessExitTarget::SyncWindows for local spawn-internal state
        └─> never enters the cross-crate ProcessExit table
```

```
Typed reducer paths that feed existing owner/effect contexts
  ├─> install/lifecycle_script_runner.rs
  │     ├─> counts output readers before process identity exists
  │     ├─> initializes LifecycleScriptExit once spawned Process exists
  │     ├─> Process stores InstallProcessExitTarget::LifecycleScript(LifecycleScriptStateHandle)
  │     ├─> stdout/stderr readers store InstallBufferedReaderTarget::LifecycleScriptOutput
  │     ├─> process exit and reader done/error mutate the same LifecycleScriptState
  │     └─> MaybeFinished drains PackageManager.active_lifecycle_scripts in bun_install
  └─> runtime/api/cron.rs
        ├─> generic SpawnCmdTarget counts stdout/stderr readers before identity exists
        ├─> CronRegisterJob stores bun_runtime_types::cron::CronRegisterJobState
        ├─> CronRemoveJob stores bun_runtime_types::cron::CronRemoveJobState
        ├─> initializes the embedded ProcessState once spawned Process exists
        ├─> spawn_cmd_generic records lower ProcessHandle and output-reader handles in that ProcessState
        ├─> reader callbacks call ProcessState::record_reader_done()/record_reader_error()
        ├─> process-exit callback validates through ProcessState::process_handle, then calls ProcessState::on_process_exit(ProcessExitContext)
        ├─> Ready lets bun_runtime take Status and stderr bytes after process/output readiness
        └─> CronRegisterJobState / CronRemoveJobState return CronProcessCompletion so bun_runtime can finish or advance with owner-local effects
```

```
Remaining owner movement
  ├─> CronRegisterJob / CronRemoveJob
  │     ├─> current owners: runtime/api/cron.rs::CronRegisterJob and CronRemoveJob
  │     │     - still own promise/KeepAlive, process ref, and stdout/stderr reader resources
  │     │     - the sidecar OS-cron state now lives in CronRegisterJobState / CronRemoveJobState: phase, title/path/schedule/tmp path, parsed expression, inert GlobalRef<()>, process reducer, status-policy reducer, and error buffer
  │     │     - spawn_cmd_generic still installs ProcessExit::{CronRegister,CronRemove} after sidecar job state records the lower process/reader handles
  │     │     - spawn_cmd_generic also still wires stdout/stderr through BufferedReaderParentLink, so reader-last completion can re-enter maybe_finished(this)
  │     │     - JSPromiseStrong now stores an inert sidecar handle, but the wrapper still owns promise effects/drop; KeepAlive/BufferedReader/Process are runtime/IO/process resources, not inert type-crate data
  │     ├─> current event-loop context
  │     │     - cron jobs run on the normal JS event loop; there is no per-cron current_context analogous to the Mini CLI State or test Coordinator context
  │     │     - bun_runtime_types now depends on bun_spawn_types and bun_jsc_types; bun_jsc_types covers inert global pointer plus non-null/nullable strong slot-handle shapes, including the JSPromiseStrongHandle shape, but not drop-owning promise/strong wrappers or promise effects
  │     ├─> current re-entry: CronJobBase::on_process_exit
  │     │     - updates ProcessExitReadiness and immediately calls maybe_finished(this)
  │     ├─> synchronous effect: maybe_finished / advance_state / finish
  │     │     - may resolve/reject promises, spawn the next cron command, free the job, or continue cron-specific cleanup
  │     └─> honest next move
  │           - split the cron job state/effect boundary into a runtime sidecar shape that both bun_spawn and bun_runtime can name, and introduce/move any lower JSC handle types before putting promise/strong-like fields in that shape
  │           - a ProcessExitTarget that stores only ProcessState preserves the reducer but loses process-exit-last synchronous owner re-entry
  │           - a ProcessExitTarget that stores CronRegisterJob*/CronRemoveJob* is the old callback owner pointer under a typed spelling
  │           - a ProcessIdentity lookup through PackageManager/runtime state would add a registry path that this branch is deliberately avoiding
  └─> Bun.spawn Subprocess
        ├─> current owner: runtime/api/bun/subprocess.rs::Subprocess
        │     - owns BackRef<Process>, JSGlobalObject/JSValue refs, stdio wrappers, abort/timer/max-buffer state, IPC state, and process auto-killer integration
        │     - embeds SubprocessExitState for lower process/stdout/stderr handles and the cached resource-usage snapshot
        │     - spawn setup still installs ProcessExit::Subprocess after stream/IPC setup and before watch/watch_or_reap
        │     - send_exit_notification currently calls proc.on_exit(...) and ignores the return value because the legacy handler runs inline; a typed target would need explicit delivery consumption there too
        ├─> existing VM process tracking
        │     - ProcessAutoKiller stores Process* -> (), only for later kill/deref; it has no Subprocess* or JS object owner slot
        │     - therefore ProcessIdentity/Process* cannot recover the Subprocess owner without adding a new registry
        ├─> current re-entry: Subprocess::on_process_exit
        │     - validates through SubprocessExitState::process_handle before applying JS wrapper effects
        │     - updates resource usage, removes timers/signals, closes terminal/stdin, resumes stdout/stderr, resolves promises, invokes onExit, disconnects IPC, and derefs self
        │     - the exit path consumes cached JS values from the generated JSSubprocess object and runs callbacks under the owning event loop
        └─> honest next move
              - move the stable subprocess state/effect boundary out of the JSC wrapper enough that bun_spawn stores a typed target and bun_runtime consumes a typed action
              - because bun_jsc depends on bun_spawn, this cannot be done by making bun_spawn or bun_runtime_types depend on bun_jsc handles directly
              - ProcessIdentity plus a runtime-side lookup would preserve neither the current allocation shape nor the direct owner lifetime edge
```

```
What a real next split must change
  ├─> cron
  │     ├─> current typed process state: ProcessState in bun_runtime_types::cron
  │     ├─> current lower handles in sidecar state: ProcessHandle + stdout/stderr BufferedReaderHandle
  │     ├─> missing typed consumer: exact cron job state-machine owner
  │     └─> valid shape: split register/remove into shared cron job state plus runtime effect applier; bun_spawn records exit into the shared state and bun_runtime advances/resolves without recovering CronRegisterJob*
  └─> Bun.spawn
        ├─> current typed data: ProcessIdentity, Status, Rusage, SubprocessExitState
        ├─> current lower handles/state in sidecar state: ProcessHandle + stdout/stderr BufferedReaderHandle + cached Rusage
        ├─> missing typed consumer: subprocess exit state that contains the JS/stdio/IPC lifetime edges without being the JS wrapper pointer
        └─> valid shape: split the stable subprocess exit state out of the generated JS wrapper enough that ProcessExitTarget names that state and runtime dispatch applies JS effects from it
```

```
Required deeper type movement
  ├─> lifecycle is now the install mixed process+reader proof point
  │     ├─> ScriptsList, LifecycleScriptState, LifecycleScriptExit, timer/alive/install context, ProcessHandle, and BufferedReaderHandle storage live in bun_install_types
  │     ├─> bun_spawn and bun_io mutate only LifecycleScriptStateHandle
  │     ├─> bun_install applies effects by draining the already-existing PackageManager.active_lifecycle_scripts heap when the typed reducer says MaybeFinished
  │     └─> no lower crate stores LifecycleScriptSubprocess*, reconstructs it from a state field, or looks it up by ProcessIdentity
  ├─> cron cannot finish with ProcessExitReadiness alone
  │     ├─> the reducers know "ready" and status policy, but maybe_finished still owns process cleanup, runtime reader access, promise resolution, follow-up spawns, and self-free
  │     ├─> CronRegisterJobState / CronRemoveJobState now own the non-JSC OS-cron job data in bun_runtime_types::cron
  │     ├─> CronRegisterState / CronRemoveState / ProcessState now live in bun_runtime_types::cron
  │     ├─> CronExpression / CronError now live in bun_runtime_types::cron_parser; only JSC date arithmetic remains in bun_runtime
  │     ├─> ProcessState now also stores ProcessHandle and output-reader handles from the production spawn path
  │     ├─> CronRegisterJobState / CronRemoveJobState now also store the inert GlobalRef<()> VM pointer through bun_jsc_types::GlobalRef
  │     ├─> CronRegisterJobState / CronRemoveJobState now own ready-status policy and return CronProcessCompletion
  │     ├─> the honest shape is still a runtime sidecar state that can own the remaining non-JSC cron transition data and expose typed actions to bun_runtime
  │     ├─> JSPromiseStrongHandle has moved below bun_jsc, but promise resolution/rejection and slot destruction still stay in the bun_runtime/bun_jsc effect layer
  │     └─> if the promise/effect owner stays only in CronRegisterJob/CronRemoveJob, any process-exit target that resumes it is still an owner callback
  └─> Bun.spawn needs a separable subprocess exit state
        ├─> the current JS wrapper owns every edge the exit path mutates: JSC refs, stdio wrappers, IPC, abort/timer state, terminal state, VM auto-killer cleanup, and self deref
        ├─> SubprocessExitState now stores the lower ProcessHandle, stdout/stderr BufferedReaderHandle, and cached Rusage from the production spawn path
        ├─> the honest shape is to split stable exit state out of the wrapper so ProcessExitTarget can name that state and runtime applies JS effects from it
        ├─> the dependency graph currently prevents putting JSC handles in bun_runtime_types because bun_jsc depends on bun_spawn and bun_spawn depends on bun_runtime_types
        ├─> GlobalRef<T>, StrongRefSlot, StrongRefHandle, OptionalStrongRefHandle, and JSPromiseStrongHandle have moved to bun_jsc_types as inert pointer/slot shapes, but JsRef/Strong/JSPromiseStrong still bring JSC handle-slot allocation, effects, and drop semantics with them
        ├─> a real split therefore needs the remaining lower JSC handle/sys sidecar work before Subprocess or cron can move all owner state below bun_runtime
        └─> ProcessAutoKiller only tracks Process* for kill/deref and does not provide that state
```

```
Typed reader-delivery follow-through
  ├─> current converted reader path
  │     ├─> SecurityScan IPC reader stores BufferedReaderTarget::Install { target: InstallBufferedReaderTarget::SecurityScanIpc, ... }
  │     │     - bun_io mutates only bun_install_types::SecurityScanExit
  │     │     - bun_install still performs scanner parsing/drain/deinit effects
  │     ├─> LifecycleScript stdout/stderr readers store BufferedReaderTarget::Install { target: InstallBufferedReaderTarget::LifecycleScriptOutput, ... }
  │     │     - bun_io mutates only bun_install_types::LifecycleScriptState
  │     │     - bun_install still prints errors and drains active lifecycle effects
  │     └─> runtime CLI readers store BufferedReaderTarget::Runtime
  │           - FilterRunHandle chunks route through RuntimeBufferedReaderDelivery::FilterRunHandleChunk
  │           - MultiRunPipeReader chunks route through RuntimeBufferedReaderDelivery::MultiRunPipeReaderChunk
  │           - TestParallelWorkerPipe chunks/done route through RuntimeBufferedReaderDelivery::{TestParallelWorkerPipeChunk,TestParallelWorkerPipeDone}
  ├─> why they are not the same as SecurityScan
  │     ├─> read chunks immediately mutate runtime-owned output state
  │     ├─> the state owner is the active Mini/JS driver context, not inert reducer state
  │     └─> bun_io cannot name the runtime owner without rebuilding the callback cycle
  └─> converted runtime-reader shape
        ├─> typed runtime reader-delivery actions live in bun_runtime_types
        ├─> bun_io stores RuntimeBufferedReaderTarget values and emits typed borrowed chunk/done/error deliveries
        ├─> dispatch goes through a single high-tier hook carrying typed action data plus the event-loop current context
        └─> no target may carry ProcessHandle*/WorkerPipe*/PipeReader* back to bun_io
```

## Runtime Tasks

Runtime tasks follow the same split: the queue item shape can be a closed enum,
but execution remains in the runtime crate because it owns JSC, C++, timers,
auto-delete semantics, and promise deref behavior.

```
Runtime task target shape
  ├─> closed queue item
  │     ├─> ShellRm
  │     ├─> ReadFile
  │     ├─> ArchiveExtract
  │     ├─> Cpp
  │     ├─> JscDeferredWork
  │     ├─> JscTimer(Immediate | WtfTimer)
  │     ├─> Concurrent(owner + AutoDelete/Manual)
  │     ├─> PosixSignal(u8)
  │     └─> NativePromiseDeferredDeref(usize)
  └─> runtime executor
        ├─> enters JSC / C++ / WebKit
        ├─> applies auto-delete ownership
        ├─> derefs native promises
        └─> drains microtasks
```

## Reader Parents

BufferedReader parent state is another owner relationship. The shape belongs
with IO/domain types; the effects stay with the owner that consumes the bytes.

```
BufferedReader target shape
  ├─> shared shape
  │     ├─> subprocess stdout/stderr
  │     ├─> shell subprocess output
  │     ├─> terminal output
  │     ├─> lifecycle script output
  │     ├─> security scan output
  │     └─> cron register/remove output
  └─> owner effects
        ├─> chunk delivery
        ├─> EOF / error handling
        ├─> max-buffer behavior
        ├─> promise / callback delivery
        └─> package-manager or runtime-local cleanup
```

SecurityScan and LifecycleScript are the install-domain reader-side
conversions:

```
SecurityScan IPC reader target
  ├─> bun_install_types::SecurityScanExit
  │     ├─> owns the IPC byte buffer
  │     ├─> records reader completion/error
  │     └─> stays incomplete while bun_install still owes local drain/deinit work
  ├─> bun_io::BufferedReaderTarget::Install
  │     ├─> stores InstallBufferedReaderTarget + EventLoopHandle
  │     ├─> the install target stores SecurityScanExitHandle
  │     ├─> provides the reader loop / event loop without naming SecurityScanSubprocess
  │     ├─> appends chunks into the typed state
  │     └─> marks IPC done on EOF/error
  └─> bun_install::SecurityScanSubprocess
        ├─> installs the target after ProcessIdentity exists
        ├─> drains a pending process-exit-first close locally before completion
        └─> parses SecurityScanExit::ipc_data() in handle_results()

LifecycleScript output reader target
  ├─> bun_install_types::LifecycleScriptState
  │     ├─> owns output readiness count and lower stdout/stderr reader handles
  │     ├─> records reader completion/error
  │     └─> shares the same LifecycleScriptExit gate as process exit
  ├─> bun_io::BufferedReaderTarget::Install
  │     ├─> stores InstallBufferedReaderTarget::LifecycleScriptOutput + EventLoopHandle
  │     ├─> records done/error through LifecycleScriptStateHandle
  │     └─> emits InstallBufferedReaderDelivery::LifecycleScriptOutput when the reducer may be ready
  └─> bun_install::LifecycleScriptSubprocess
        ├─> installs the target before starting stdout/stderr readers
        ├─> reports reader errors with the same script/package/errno output
        └─> drains ready nodes from PackageManager.active_lifecycle_scripts
```

## Safety Invariants

```
Safety invariants
  ├─> typed construction
  │     └─> producer code names a marker type, not a raw integer tag
  ├─> centralized recovery
  │     └─> pointer recovery happens in the owner dispatch site for that family
  ├─> complete discriminants
  │     └─> every runtime dispatch arm has a sibling marker in the type crate
  ├─> effect ownership
  │     └─> `_types` crates do not own VM, package-manager, process, or kernel effects
  ├─> kernel ABI boundaries
  │     └─> scalar tokens remain scalar until immediately decoded at the IO layer
  └─> crate direction
        └─> lower crates depend on sibling type crates; higher crates depend on both
```

## Migration Shape

```
Production migration
  ├─> move each shared owner/state family into the natural sibling type crate
  ├─> replace raw tag constants with associated marker types at generic producer boundaries
  ├─> keep direct constructors small: Owner::typed::<Variant>(ptr)
  ├─> keep effect application in the owning crate
  ├─> add reducer tests in the type crate for value-only state machines
  └─> add production-path tests around the owner crate where effects are applied
```
