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
Natural sibling crates
  ├─> bun_io_types
  │     ├─> owner::OwnerToken<T>
  │     │     - non-zero typed pointer identity
  │     ├─> pollable::Token
  │     │     - preserves the epoll/kqueue u64 packing boundary
  │     └─> file_poll
  │           ├─> Kind
  │           ├─> Owner { kind, addr }
  │           └─> marker variants such as Process, FileSink, BufferedReader, DnsResolver
  ├─> bun_spawn_types
  │     ├─> Status / Exited / WaitPidResult / Rusage
  │     ├─> ProcessIdentity
  │     └─> ProcessExitContext
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
  │     └─> bun_io::FilePoll stores bun_io_types::file_poll::Owner
  └─> consumer
        └─> bun_runtime::dispatch::__bun_run_file_poll
              ├─> matches owner.kind()
              ├─> recovers owner.ptr() in the one runtime dispatch site
              └─> calls the concrete handler for that closed owner kind
```

The important detail is that writer families no longer thread a raw
`PollTag` constant. A producer declares the owner marker type instead:

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

Process exit should use the same boundary, with value-only state below and
effect application above.

```
Process-exit target shape
  ├─> bun_spawn_types
  │     ├─> ProcessIdentity
  │     ├─> ProcessExitContext { process, status, rusage }
  │     └─> common process status / rusage values
  ├─> bun_install_types
  │     ├─> LifecycleScriptExit
  │     │     └─> returns LifecycleScriptExitAction
  │     └─> SecurityScanExit
  │           └─> returns SecurityScanExitAction
  └─> owning crates
        ├─> bun_spawn observes waitpid / platform wait completion
        ├─> bun_runtime applies subprocess, shell, cron, webview, and JSC effects
        └─> bun_install applies package-manager lifecycle/security effects
```

The type-level transition receives values, mutates only its own state, and
returns an action:

```rust
pub struct ProcessExitContext<'a> {
    pub process: ProcessIdentity,
    pub status: Status,
    pub rusage: &'a Rusage,
}

pub enum ProcessExitEffect {
    Updated {
        status: ProcessStatusUpdate,
    },
    Subprocess {
        status: ProcessStatusUpdate,
        action: SubprocessExitAction,
    },
    LifecycleScript {
        status: ProcessStatusUpdate,
        action: LifecycleScriptExitAction,
    },
    SecurityScan {
        status: ProcessStatusUpdate,
        action: SecurityScanExitAction,
    },
    Cron {
        status: ProcessStatusUpdate,
        action: CronExitAction,
    },
    Webview {
        status: ProcessStatusUpdate,
        action: WebviewExitAction,
    },
    IgnoredWrongProcess,
}
```

```
Effect application
  ├─> status writes stay with the live Process owner
  ├─> promise / callback / microtask work stays with bun_runtime
  ├─> lifecycle and security scan package-manager work stays with bun_install
  ├─> process refs and WebKit/JSC handles stay in their owning crate
  └─> pure completion ordering and readiness gates can live in sibling types crates
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
