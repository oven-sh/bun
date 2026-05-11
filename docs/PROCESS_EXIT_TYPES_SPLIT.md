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
  │     │     ├─> depends on bun_spawn_types
  │     │     └─> owns runtime-domain process/task state, not JSC effects
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
  ├─> bun_install_types
  │     ├─> LifecycleScriptExit
  │     └─> SecurityScanExit
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

This branch proves six production paths plus one Mini-shell hard-case slice.
WebView process exits use the
runtime sidecar path: `bun_spawn` stores a `RuntimeProcessExitTarget`, emits a
`RuntimeProcessExitAction`, and `bun_runtime::dispatch` applies the Chrome/Host
effects. Security scanner exits use the install sidecar path: `bun_spawn` stores
an `InstallProcessExitTarget::SecurityScan(NonNull<SecurityScanExit>)` and only
marks typed install state. Security scanner IPC reader callbacks also record
into `SecurityScanExit` through `bun_io::BufferedReaderTarget::SecurityScanIpc`,
so the reader side no longer asks `bun_io` to call back into
`SecurityScanSubprocess*`; `bun_install` still owns the local drain/deinit and
result parsing effects before it reports the scanner done. The Windows
sync-spawn path is a local spawn-internal
case: `SyncWindowsProcess` is not a cross-crate owner, so it now uses a local
`ProcessExitTarget::SyncWindows` arm inside `bun_spawn`. `bun run --filter` and
`bun run --parallel` use runtime sidecar targets keyed by their existing handle
slots; `bun_runtime::dispatch` consumes the typed action and synchronously
re-enters the current `MiniEventLoop` context. Parallel test workers use the
same runtime sidecar action pattern with the JS event loop: the target stores
only the worker slot index, and `run_as_coordinator` exposes its stack-owned
`Coordinator` as the current JS-loop driver context while `coord.drive()` runs.
Mini shell subprocesses use the same idea with shell arena identity:
`bun_spawn` stores `RuntimeProcessExitTarget::ShellCommand { command: NodeId }`,
the standalone-shell driver exposes the live `Interpreter` as the Mini tick
context, and runtime dispatch calls back into the command arena by `NodeId`
without storing `ShellSubprocess*` in the process.

Lifecycle scripts and cron register/remove already use typed readiness reducers
for process/output ordering, but their `ProcessExit` owner re-entry remains a
separate type-movement problem: when process exit is the last event, the current
callback synchronously resumes the owning lifecycle/cron state and may free or
restart that owner. A reducer pointer alone cannot preserve that behavior. The
JS shell path has the same owner-movement requirement: a JS event loop can have
multiple live shell interpreters, so a single loop `current_context` is not an
identity for the interpreter.

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

pub enum InstallProcessExitTarget {
    SecurityScan(NonNull<SecurityScanExit>),
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
  │     ├─> installs ProcessExitTarget::Install(SecurityScan(exit_state))
  │     ├─> installs BufferedReaderTarget::SecurityScanIpc(exit_state, event_loop)
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
  │     └─> runtime dispatch can rely on the same typed current-context boundary for JS and Mini drivers
  ├─> runtime/shell/interpreter.rs and subproc.rs
  │     ├─> standalone shell passes the live Interpreter as MiniEventLoop tick context
  │     ├─> Mini shell subprocesses install RuntimeProcessExitTarget::ShellCommand { command: NodeId }
  │     ├─> bun_spawn emits RuntimeProcessExitAction::ShellCommand with NodeId + ProcessIdentity + Status
  │     ├─> direct wait/immediate-exit paths dispatch the same typed delivery with the known interpreter context
  │     └─> JS shell keeps the legacy handler until interpreter identity moves out of the JS owner object graph
  └─> spawn/process.rs sync Windows path
        ├─> stores ProcessExitTarget::SyncWindows for local spawn-internal state
        └─> never enters the cross-crate ProcessExit table
```

```
Reducer prework that still needs owner type movement
  ├─> install/lifecycle_script_runner.rs
  │     ├─> counts output readers before process identity exists
  │     ├─> initializes LifecycleScriptExit once spawned Process exists
  │     ├─> reader callbacks call record_reader_done()
  │     ├─> process-exit callback calls on_process_exit(ProcessExitContext)
  │     └─> MaybeFinished applies handle_exit() in bun_install
  └─> runtime/api/cron.rs
        ├─> generic SpawnCmdTarget counts stdout/stderr readers before identity exists
        ├─> initializes ProcessExitReadiness once spawned Process exists
        ├─> CronRegisterJob and CronRemoveJob store the reducer directly
        ├─> reader callbacks call record_reader_done()
        ├─> process-exit callback calls on_process_exit(ProcessExitContext)
        └─> Ready lets bun_runtime consume status and continue cron-specific state transitions
```

```
Remaining owner movement
  ├─> LifecycleScriptSubprocess
  │     ├─> current owner: install/lifecycle_script_runner.rs::LifecycleScriptSubprocess
  │     │     - owns PackageManager backref, process ref, stdout/stderr readers, envp, timer, intrusive heap node
  │     │     - spawn_next_script_inner still installs ProcessExit::LifecycleScript after ProcessIdentity exists
  │     ├─> current event-loop context
  │     │     - PackageManager::tick_lifecycle_scripts / sleep pass PackageManager* as AnyEventLoop context
  │     │     - that proves the manager is live, but it does not identify which active LifecycleScriptSubprocess finished
  │     ├─> current re-entry: LifecycleScriptSubprocess::on_process_exit
  │     │     - validates ProcessIdentity, updates LifecycleScriptExit, then calls apply_exit_action()
  │     ├─> synchronous effect: LifecycleScriptSubprocess::handle_exit
  │     │     - may print output, mutate PackageManager/installer state, spawn the next script, destroy self, or exit process
  │     └─> honest next move
  │           - move the lifecycle owner/effect boundary far enough into bun_install_types that ProcessExitTarget can carry a typed state/handle whose Ready action is directly consumable
  │           - a NonNull<LifecycleScriptExit> target by itself is only reducer state; using it to recover LifecycleScriptSubprocess would be the old owner-pointer coupling under a field-offset disguise
  │           - scanning PackageManager.active_lifecycle_scripts by ProcessIdentity would add the side lookup path this branch is specifically rejecting
  ├─> CronRegisterJob / CronRemoveJob
  │     ├─> current owners: runtime/api/cron.rs::CronRegisterJob and CronRemoveJob
  │     │     - own promise/global/KeepAlive, process ref, stdout/stderr readers, tmp path, error state, and state-machine enum
  │     │     - spawn_cmd_generic still installs ProcessExit::{CronRegister,CronRemove} after ProcessExitReadiness exists
  │     ├─> current event-loop context
  │     │     - cron jobs run on the normal JS event loop; there is no per-cron current_context analogous to the Mini CLI State or test Coordinator context
  │     ├─> current re-entry: CronJobBase::on_process_exit
  │     │     - updates ProcessExitReadiness and immediately calls maybe_finished(this)
  │     ├─> synchronous effect: maybe_finished / advance_state / finish
  │     │     - may resolve/reject promises, spawn the next cron command, free the job, or continue cron-specific cleanup
  │     └─> honest next move
  │           - split the cron job state/effect boundary into a runtime sidecar shape that both bun_spawn and bun_runtime can name
  │           - a ProcessIdentity lookup through PackageManager/runtime state would add a registry path that this branch is deliberately avoiding
  ├─> Bun.spawn Subprocess
  │     ├─> current owner: runtime/api/bun/subprocess.rs::Subprocess
  │     │     - owns BackRef<Process>, JSGlobalObject/JSValue refs, stdio wrappers, abort/timer/max-buffer state, IPC state, and process auto-killer integration
  │     │     - spawn setup still installs ProcessExit::Subprocess after stream/IPC setup and before watch/watch_or_reap
  │     ├─> existing VM process tracking
  │     │     - ProcessAutoKiller stores Process* -> (), only for later kill/deref; it has no Subprocess* or JS object owner slot
  │     │     - therefore ProcessIdentity/Process* cannot recover the Subprocess owner without adding a new registry
  │     ├─> current re-entry: Subprocess::on_process_exit
  │     │     - updates resource usage, removes timers/signals, closes terminal/stdin, resumes stdout/stderr, resolves promises, invokes onExit, disconnects IPC, and derefs self
  │     └─> honest next move
  │           - move the stable subprocess state/effect boundary out of the JSC wrapper enough that bun_spawn stores a typed target and bun_runtime consumes a typed action
  │           - ProcessIdentity plus a runtime-side lookup would preserve neither the current allocation shape nor the direct owner lifetime edge
  └─> JS shell subprocesses
        ├─> current owner: runtime/shell/subproc.rs::ShellSubprocess
        │     - Mini shell now uses ShellCommand { command: NodeId } because its tick context is the live Interpreter
        ├─> remaining JS path
        │     - spawn_async still installs ProcessExit::Shell for EventLoopHandle::Js
        │     - a single JS EventLoop.current_context cannot identify one Interpreter because multiple shell interpreters can be live on one JS event loop
        └─> honest next move
              - move JS shell interpreter identity into sidecar state, or arrange a per-shell typed driver context that is already present when the process exit is delivered
              - storing ShellSubprocess* or CmdHandle in ProcessExitTarget would be the old owner callback in typed clothing
```

```
What a real next split must change
  ├─> lifecycle
  │     ├─> current typed reducer: LifecycleScriptExit in bun_install_types
  │     ├─> missing typed consumer: exact lifecycle owner/effect state, not PackageManager as a broad context
  │     └─> valid shape: move the lifecycle completion state that owns "spawn next / finish / destroy" decisions into an install sidecar type, then let bun_install apply only the package-manager effects
  ├─> cron
  │     ├─> current typed reducer: ProcessExitReadiness in bun_spawn_types
  │     ├─> missing typed consumer: exact cron job state-machine owner
  │     └─> valid shape: split register/remove into shared cron job state plus runtime effect applier; bun_spawn records exit into the shared state and bun_runtime advances/resolves without recovering CronRegisterJob*
  ├─> Bun.spawn
  │     ├─> current typed data: ProcessIdentity, Status, Rusage
  │     ├─> missing typed consumer: subprocess exit state that contains the JS/stdio/IPC lifetime edges without being the JS wrapper pointer
  │     └─> valid shape: split the stable subprocess exit state out of the generated JS wrapper enough that ProcessExitTarget names that state and runtime dispatch applies JS effects from it
  └─> JS shell
        ├─> current typed data: NodeId in bun_runtime_types::shell
        ├─> missing typed consumer: interpreter identity for the JS event-loop path
        └─> valid shape: make the JS shell driver expose a per-interpreter typed context at process-exit delivery time, or move interpreter identity/state into a shell sidecar that is not a ShellSubprocess*/CmdHandle pointer
```

```
Required deeper type movement
  ├─> lifecycle cannot finish with the current split alone
  │     ├─> the reducer knows "ready", but handle_exit also needs:
  │     │     - script/package/env/timer/install state
  │     │     - process close/deref authority
  │     │     - stdout/stderr buffers and reader teardown/reuse
  │     │     - PackageManager/Installer effects
  │     ├─> the honest shape is to move the lifecycle command state, including the data needed after readiness, into bun_install_types
  │     ├─> ProcessHandle is now carried by ProcessExitContext as the lower-tier process identity handle
  │     ├─> BufferedReaderHandle is now threaded through typed BufferedReaderTarget callbacks
  │     ├─> lifecycle still needs the command state/storage split that owns those handles without recovering LifecycleScriptSubprocess
  │     └─> otherwise the code must recover LifecycleScriptSubprocess from a state field, heap node, ProcessIdentity scan, or parent pointer, which is the callback architecture again
  ├─> cron cannot finish with ProcessExitReadiness alone
  │     ├─> the reducer knows "ready", but maybe_finished owns the cron state machine, process cleanup, stderr inspection, promise resolution, follow-up spawns, and self-free
  │     ├─> the honest shape is a runtime sidecar state that can own the non-JSC cron transition data and expose typed actions to bun_runtime
  │     └─> if the promise/global owner stays only in CronRegisterJob/CronRemoveJob, any process-exit target that resumes it is still an owner callback
  ├─> Bun.spawn needs a separable subprocess exit state
  │     ├─> the current JS wrapper owns every edge the exit path mutates: JSC refs, stdio wrappers, IPC, abort/timer state, terminal state, VM auto-killer cleanup, and self deref
  │     ├─> the honest shape is to split stable exit state out of the wrapper so ProcessExitTarget can name that state and runtime applies JS effects from it
  │     └─> ProcessAutoKiller only tracks Process* for kill/deref and does not provide that state
  └─> JS shell needs interpreter identity below the process-exit event
        ├─> Mini shell works because the Mini driver supplies the live Interpreter as typed tick context
        ├─> JS shell has a shared JS event loop with multiple possible interpreters
        └─> the honest shape is per-interpreter typed driver context or sidecar-owned interpreter identity, not ShellSubprocess*/CmdHandle recovery
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

The SecurityScan reader is the first production reader-side conversion:

```
SecurityScan IPC reader target
  ├─> bun_install_types::SecurityScanExit
  │     ├─> owns the IPC byte buffer
  │     ├─> records reader completion/error
  │     └─> stays incomplete while bun_install still owes local drain/deinit work
  ├─> bun_io::BufferedReaderTarget::SecurityScanIpc
  │     ├─> stores NonNull<SecurityScanExit> + EventLoopHandle
  │     ├─> provides the reader loop / event loop without naming SecurityScanSubprocess
  │     ├─> appends chunks into the typed state
  │     └─> marks IPC done on EOF/error
  └─> bun_install::SecurityScanSubprocess
        ├─> installs the target after ProcessIdentity exists
        ├─> drains a pending process-exit-first close locally before completion
        └─> parses SecurityScanExit::ipc_data() in handle_results()
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
