# Closed Dispatch `_types` Split PoC

Status: PoC branch with compileable type crates and focused tests.

The pattern in this branch is closed typed storage below, ordinary Rust dispatch
above. A `_types` crate may own inert state, discriminants, typed owner tokens,
and pure reducers. When a transition needs runtime-local behavior, JSC handles,
allocator/lifetime ownership, process ref changes, or kernel registration, the
types layer returns a typed action and the owning crate performs the effect.

```
Consistent rule
  ├─> `_types` crates own shape
  │     ├─> closed enums instead of erased `{ tag, *mut () }`
  │     ├─> typed owner tokens instead of bare pointer identity
  │     ├─> value-only event inputs such as ProcessExitContext
  │     └─> pure state reducers for readiness gates and completion ordering
  └─> owner crates own effects
        ├─> JSC entry, VM notification, promise resolution, and microtask drains
        ├─> process status writes, ref drops, kills, and platform handles
        ├─> FilePoll / kqueue / epoll registration and deregistration
        └─> C++/WebKit opaque task execution
```

## Implemented Topology

```
PoC crate topology
  ├─> bun_spawn_types
  │     ├─> Status / Exited / WaitPidResult / Rusage
  │     ├─> ProcessIdentity
  │     └─> ProcessExitContext
  │           - value-only: process identity + status + rusage
  │           - no `&mut Process`, no type-erased process method table
  ├─> bun_install_types
  │     ├─> LifecycleScriptExit
  │     └─> SecurityScanExit
  │           - package-manager-local completion state
  │           - pure transitions returning LifecycleScriptExitAction / SecurityScanExitAction
  └─> bun_runtime_types
        ├─> ProcessExit
        │     ├─> Subprocess / LifecycleScript / SecurityScan / Shell
        │     ├─> FilterRunHandle / MultiRunHandle / TestParallelWorker
        │     ├─> CronRegister / CronRemove
        │     └─> ChromeProcess / HostProcess / SyncWindows
        ├─> RuntimeTask
        │     ├─> ShellRm / ReadFile / ArchiveExtract
        │     ├─> Cpp / JscDeferredWork
        │     ├─> JscTimer(Immediate | WtfTimer)
        │     ├─> Concurrent(owner + AutoDelete/Manual)
        │     ├─> PosixSignal(u8)
        │     └─> NativePromiseDeferredDeref(usize)
        ├─> FilePollOwner
        │     ├─> Process / FileSink
        │     ├─> runtime/shell/security static pipe writers
        │     ├─> DNS / getaddrinfo
        │     └─> ShellBufferedWriter
        ├─> PollableToken
        │     └─> kernel-facing u64 decoded into typed ReadFile/WriteFile owners
        └─> BufferedReaderParent
              ├─> subprocess / shell / terminal
              ├─> cron register/remove
              └─> lifecycle script / security scan
```

## Process Exit Shape

Process exit is value-in, effect-out. The type crate does not receive a mutable
process reference. It updates only the closed handler state and returns the work
that the runtime crate should perform.

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

That makes the high crate responsible for applying effects:

```
runtime process-exit handling
  ├─> waitpid / platform wait produces ProcessExitContext
  ├─> ProcessExitState::on_process_exit(&ctx)
  │     ├─> mutates only the stored typed handler state
  │     └─> returns ProcessExitEffect
  └─> bun_runtime applies the effect
        ├─> update Process.status from ProcessStatusUpdate
        ├─> notify VM / promise / cron / scanner / webview owners
        ├─> drop process refs where WebviewExitAction requests it
        └─> drain microtasks where SubprocessExitAction requests it
```

The install examples follow the same rule. `LifecycleScriptExit` and
`SecurityScanExit` live in `bun_install_types` because their state belongs to
the installer domain, but they only perform local bookkeeping and return
actions. They do not touch the package manager, IPC reader, process object, or
JSC.

## Runtime Task Shape

Runtime task dispatch is modeled as a closed enum plus a high host trait:

```rust
pub enum RuntimeTask {
    ShellRm(ShellRmTask),
    ReadFile(ReadFileTask),
    ArchiveExtract(ArchiveExtractTask),
    Cpp(CppTask),
    JscDeferredWork(JscDeferredWorkTask),
    JscTimer(JscTimerTask),
    Concurrent(ConcurrentRuntimeTask),
    PosixSignal(PosixSignalTask),
    NativePromiseDeferredDeref(NativePromiseDeferredDerefTask),
}
```

```
task dispatch risks covered
  ├─> normal pointer-like tasks
  │     ├─> ShellRm
  │     ├─> ReadFile
  │     └─> ArchiveExtract
  ├─> opaque JSC / C++ tasks
  │     ├─> CppTask
  │     └─> JscDeferredWorkTask
  ├─> timer/immediate wakeups
  │     └─> JscTimerTask::Immediate / JscTimerTask::WtfTimer
  ├─> cross-thread return ownership
  │     └─> ConcurrentRuntimeTask { owner, deinit: AutoDelete | Manual }
  └─> non-pointer payloads that were shoved through pointer storage before
        ├─> PosixSignalTask { signal: u8 }
        └─> NativePromiseDeferredDerefTask { index: usize }
```

The type crate owns the queue item shape. `bun_runtime` still owns entry into
JSC, task execution, auto-delete semantics, promise deref, and microtask
draining.

## IO Shape

FilePoll and Pollable are separate because one is a Bun owner relationship and
the other crosses a kernel `u64` boundary.

```
IO dispatch risks covered
  ├─> FilePollOwner
  │     ├─> typed enum stored in Bun-owned poll state
  │     ├─> no erased owner pointer
  │     └─> high FilePollHost performs the owner-specific effect
  ├─> PollableToken
  │     ├─> preserves the kernel-facing u64 token
  │     ├─> decodes into PollableOwner::ReadFile / PollableOwner::WriteFile
  │     └─> keeps the raw boundary explicit instead of infecting every caller
  └─> BufferedReaderParent
        ├─> stores the parent relationship as a closed enum
        ├─> covers subprocess, shell, terminal, cron, lifecycle, security scan
        └─> lets each owning crate handle chunks, EOF, errors, and overflow
```

## What This Proves

```
Risk matrix from the reports
  ├─> circular ownership
  │     └─> resolved by moving shared shape into `_types`, not by inverting all behavior
  ├─> unsafe type coupling
  │     └─> replaced with closed enums and typed owner tokens at Bun-owned boundaries
  ├─> JSC / VM effects
  │     └─> kept above the type layer as host calls or action application
  ├─> C++ / WebKit opaque tasks
  │     └─> represented as typed opaque owners, executed only by the runtime owner
  ├─> non-pointer task payloads
  │     └─> represented directly as `u8` / `usize` variants
  ├─> kernel tokens
  │     └─> raw `u64` remains at the OS boundary, decoded immediately after
  ├─> readiness gates
  │     └─> pure reducers live in type crates and return actions
  └─> process exit state
        └─> status/ref/JSC behavior is returned as effects rather than hidden in `_types`
```

## Implementation Cuts

```
Remaining wiring
  ├─> replace current call sites with constructors for the closed enum variants
  ├─> move any missing sibling-owned state into the matching `bun_*_types` crate
  ├─> implement the runtime host/action appliers in bun_runtime / bun_install / bun_shell
  ├─> delete the erased link-interface registrations arm by arm
  └─> keep PollableToken as the explicit raw boundary for epoll/kqueue tokens
```

The important part is the invariant: every family uses the same boundary. The
types crates define complete closed shapes and pure reducers; the owning crates
apply effects. That avoids dependency cycles without replacing erased pointers
with a different form of hidden cross-crate behavior.
