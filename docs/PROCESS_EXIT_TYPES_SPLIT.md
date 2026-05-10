# Static ProcessExit `_types` Split

Status: PoC branch with compileable type crates.

The Rust-idiomatic shape is to put the shared process-exit data model in
`*_types` crates and make dispatch an ordinary match over a closed enum. The
enum carries concrete Rust types. The crates that need to construct, store, or
dispatch process exits all depend on that shared type layer.

```
Static ProcessExit topology
  ├─> bun_spawn_types
  │     ├─> Status / Exited / WaitPidResult
  │     ├─> Rusage
  │     ├─> ProcessExitState
  │     └─> ProcessExitContext
  │           - the process-exit facts a handler receives
  │           - process identity / status / rusage
  │           - small, spawn-level operations that belong below runtime
  ├─> bun_install_types
  │     └─> LifecycleScriptExit
  │           - package/script/output state needed after child exit
  ├─> bun_shell_types
  │     └─> ShellSubprocessExit
  │           - command parent handle, shell event-loop handle, stdio state
  ├─> bun_runtime_types
  │     ├─> SubprocessExit
  │     ├─> LifecycleScriptExit
  │     ├─> SecurityScanExit
  │     ├─> ShellSubprocessExit
  │     ├─> FilterRunExit
  │     ├─> MultiRunExit
  │     ├─> TestParallelWorkerExit
  │     ├─> CronRegisterExit
  │     ├─> CronRemoveExit
  │     ├─> ChromeProcessExit
  │     ├─> HostProcessExit
  │     └─> ProcessExit
  │           - closed enum over the concrete exit-state structs
  └─> bun_runtime
        ├─> depends on the same *_types crates
        ├─> owns the implementation modules for those concrete types
        └─> dispatches ProcessExit with a normal enum match
```

The dispatch surface is ordinary Rust:

```rust
pub enum ProcessExit {
    Subprocess(SubprocessExit),
    LifecycleScript(LifecycleScriptExit),
    SecurityScan(SecurityScanExit),
    Shell(ShellSubprocessExit),
    FilterRunHandle(FilterRunExit),
    MultiRunHandle(MultiRunExit),
    TestParallelWorker(TestParallelWorkerExit),
    CronRegister(CronRegisterExit),
    CronRemove(CronRemoveExit),
    ChromeProcess(ChromeProcessExit),
    HostProcess(HostProcessExit),
    SyncWindows(SyncWindowsExit),
}

impl ProcessExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        match self {
            Self::Subprocess(exit) => exit.on_process_exit(ctx),
            Self::LifecycleScript(exit) => exit.on_process_exit(ctx),
            Self::SecurityScan(exit) => exit.on_process_exit(ctx),
            Self::Shell(exit) => exit.on_process_exit(ctx),
            Self::FilterRunHandle(exit) => exit.on_process_exit(ctx),
            Self::MultiRunHandle(exit) => exit.on_process_exit(ctx),
            Self::TestParallelWorker(exit) => exit.on_process_exit(ctx),
            Self::CronRegister(exit) => exit.on_process_exit(ctx),
            Self::CronRemove(exit) => exit.on_process_exit(ctx),
            Self::ChromeProcess(exit) => exit.on_process_exit(ctx),
            Self::HostProcess(exit) => exit.on_process_exit(ctx),
            Self::SyncWindows(exit) => exit.on_process_exit(ctx),
        }
    }
}
```

## ProcessExit Owners

```
Current owner families to split
  ├─> Subprocess
  │     ├─> source: src/runtime/api/bun/subprocess.rs
  │     ├─> type crate: bun_runtime_types
  │     └─> exit state: JS handle, process handle, rusage, stream/IPC/timer state
  ├─> LifecycleScriptSubprocess
  │     ├─> source: src/install/lifecycle_script_runner.rs
  │     ├─> type crate: bun_install_types
  │     └─> exit state: script index, package name, output readers, manager task state
  ├─> SecurityScanSubprocess
  │     ├─> source: src/install/PackageManager/security_scanner.rs
  │     ├─> type crate: bun_install_types
  │     └─> exit state: scanner IPC/result buffers and fd-completion state
  ├─> ShellSubprocess
  │     ├─> source: src/runtime/shell/subproc.rs
  │     ├─> type crate: bun_shell_types
  │     └─> exit state: command parent handle, stdio handles, shell event-loop handle
  ├─> filter/multi-run ProcessHandle
  │     ├─> sources: src/runtime/cli/filter_run.rs, src/runtime/cli/multi_run.rs
  │     ├─> type crate: bun_runtime_types
  │     └─> exit state: process slot, dependency graph state, timing/status fields
  ├─> test Worker
  │     ├─> source: src/runtime/cli/test/parallel/Worker.rs
  │     ├─> type crate: bun_runtime_types
  │     └─> exit state: worker index, coordinator handle, IPC channel state
  ├─> cron register/remove jobs
  │     ├─> source: src/runtime/api/cron.rs
  │     ├─> type crate: bun_runtime_types
  │     └─> exit state: promise/global handles, process state, output readers
  └─> webview host processes
        ├─> sources: src/runtime/webview/ChromeProcess.rs, src/runtime/webview/HostProcess.rs
        ├─> type crate: bun_runtime_types
        └─> exit state: process lifetime state and singleton ownership state
```

## Migration Shape

```
Migration slice
  ├─> split spawn facts into bun_spawn_types
  │     ├─> Status / Exited / WaitPidResult
  │     ├─> Rusage
  │     ├─> ProcessExitState
  │     └─> ProcessExitContext<'a>
  ├─> split one owner family into its *_types crate
  │     ├─> data struct moves first
  │     ├─> implementation follows in the owning runtime/install/shell crate
  │     └─> constructors return the concrete exit-state value
  ├─> add ProcessExit enum in bun_runtime_types
  │     ├─> variants carry concrete exit-state structs
  │     └─> match dispatch calls inherent methods on those structs
  ├─> thread ProcessExit through process creation
  │     ├─> spawn callers construct the enum variant at the call site
  │     └─> process-exit delivery receives and mutates the enum directly
  └─> repeat for the remaining owner families
        ├─> each arm deletes one cross-crate registration point
        └─> each arm leaves one normal enum variant plus one normal method body
```

This makes the process-exit relationship visible in Cargo topology: shared data
lives in `*_types`, implementation crates depend on those types, and the final
runtime crate performs dispatch with a closed Rust enum.
