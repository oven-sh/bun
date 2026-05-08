# `bun_spawn_sys` crate split — proposal

## Problem

`bun_spawn` (src/spawn/) currently bundles two concerns:

1. **Raw OS spawn** — `posix_spawn_bun` FFI, `posix_spawnp` libc wrappers,
   `Actions`/`Attr` repr(C) structs, `wait4`/`waitpid`, signal forwarding
   (`Bun__registerSignalsForForwarding`), `Rusage`. None of this needs an
   event loop.
2. **Event-loop integration** — `Process` (intrusive-refcounted, `Poller`,
   `KeepAlive`), `WaiterThread`, `sync::spawn` job-control / no-orphans /
   subreaper machinery, `StaticPipeWriter`. All of this depends on
   `bun_aio`, `bun_event_loop`, `bun_io`, `bun_crash_handler`,
   `bun_threading`.

`bun_install`, `bun_patch`, `bun_jsc` only need (1) but pull in (2)'s
dependency cone. The `Option<*const c_char>`-layout EFAULT this commit fixes
is exactly the kind of bug a tightly-typed `-sys` boundary would have
prevented (Zig `?[*:0]const u8` ↔ Rust `*const c_char`, never `Option<*const T>`).

## Proposed crate graph

```
bun_libuv_sys  (already exists, src/libuv_sys/)
     │  raw uv_* FFI: uv_spawn, uv_process_t, uv_pipe_t, uv_loop_t
     │  Windows-only at runtime; no bun deps.
     ▼
bun_spawn_sys  (NEW, src/spawn_sys/)
     │  deps: libc, bun_sys (Fd/E/Tag/Result), bun_libuv_sys (cfg(windows))
     │  NO bun_event_loop / bun_aio / bun_io / bun_threading.
     ▼
bun_spawn      (src/spawn/, slimmed)
     │  deps: bun_spawn_sys, bun_aio, bun_event_loop, bun_io, bun_ptr,
     │        bun_threading, bun_crash_handler
     ▼
bun_runtime    (re-exports api::bun_process from bun_spawn)
```

## What moves into `bun_spawn_sys`

From `src/spawn/posix_spawn.rs` — **the whole file**:

- `bun_spawn::{Action, Actions, Attr, FileActionType}` repr(C) mirrors of
  `bun_spawn_request_file_action_t` / `bun_spawn_request_t` in
  `src/jsc/bindings/bun-spawn.cpp`.
- `posix_spawn::{BunSpawnRequest, ActionsList, spawn_z, WaitPidResult, wait4,
waitpid}`.
- `extern "C" posix_spawn_bun(...)` FFI decl.
- macOS `PosixSpawnActions` / `PosixSpawnAttr` libc wrappers.
- `posix_spawnattr_reset_signals` extern.

From `src/spawn/process.rs`:

- `spawn_process_posix` + `PosixSpawnFdGuard` + `set_spawned_stdio` (the
  fd/action plumbing — depends only on `bun_sys` + the structs above).
- `PosixSpawnOptions`, `PosixStdio`, `PosixSpawnResult`, `ExtraPipe`,
  `StdioKind`, `Dup2`, `Rusage`.
- `spawn_process_windows` thin layer over `uv_spawn` (re-exported via
  `bun_libuv_sys`), `WindowsSpawnOptions`, `WindowsStdio`,
  `WindowsStdioResult`.
- `extern "C"` block: `Bun__registerSignalsForForwarding`,
  `Bun__unregisterSignalsForForwarding`, `Bun__currentSyncPID`,
  `Bun__sendPendingSignalIfNecessary`, `Bun__noOrphans_*`.
- A canonical `type Envp = *const *const c_char;` /
  `type Argv = *const *const c_char;` alias plus a
  `const _: () = assert!(size_of::<*const c_char>() == size_of::<usize>())`
  layout guard. **No `Option<*const c_char>` in any FFI signature.**

`bun_spawn_sys` Cargo deps:

```toml
libc, bstr, scopeguard
bun_sys           # Fd, E, Tag, Result, O, socketpair, memfd_create
bun_core          # Error, handle_oom (optional — could shrink to bun_errno)
bun_analytics     # features::spawn counter (or push counter up into bun_spawn)
[target.'cfg(windows)'.dependencies]
bun_libuv_sys
```

## What stays in `bun_spawn`

- `Process` struct, `Poller`, `ProcessExitHandler`/`ProcessExitVTable`,
  `Status` (lifecycle, not the syscall).
- `WaiterThread` (needs `bun_threading`).
- `sync` module: `spawn`, `spawn_with_argv`, `spawn_posix`,
  `SignalForwarding` RAII, `JobControl`, `ParentDeathWatchdog`,
  `SyncWindowsProcess`/`SyncWindowsPipeReader`.
- `StaticPipeWriter` (needs `bun_io::BufferedWriter`).
- `to_process` / `enable_keeping_event_loop_alive` (needs
  `bun_aio::KeepAlive`, `bun_event_loop::EventLoopHandle`).

`bun_spawn` re-exports `bun_spawn_sys::*` so existing callers
(`bun_runtime::api::bun_process`, `lifecycle_script_runner`) are untouched.

## Where `bun_libuv_sys` fits

Already exists at `src/libuv_sys/`. It is the Windows analogue of
`posix_spawn_bun`: raw `uv_spawn`, `uv_process_options_t`, `uv_stdio_container_t`,
`uv_pipe_t`. `bun_spawn_sys` depends on it under `cfg(windows)` only;
`bun_spawn` depends on it for the `SyncWindowsPipeReader` callbacks
(`read_start`/`close`). Nothing else changes there — it's already a leaf
`-sys` crate with no `bun_*` deps beyond utility macros.

## Migration steps

1. `mkdir src/spawn_sys`, add to workspace `Cargo.toml`.
2. `git mv src/spawn/posix_spawn.rs src/spawn_sys/posix_spawn.rs`.
3. Split `src/spawn/process.rs`: move `spawn_process_posix` /
   `spawn_process_windows` / option/result structs into
   `src/spawn_sys/spawn_process.rs`; leave `Process`/`Poller`/`sync`/
   `WaiterThread` in `src/spawn/process.rs`.
4. `bun_spawn` adds `bun_spawn_sys.workspace = true` and
   `pub use bun_spawn_sys::{posix_spawn, spawn_process_posix, ...};`.
5. Drop `bun_aio`/`bun_event_loop`/`bun_io`/`bun_threading`/
   `bun_crash_handler` from `bun_spawn_sys/Cargo.toml`; keep them in
   `bun_spawn`.
6. `cargo build -p bun_spawn_sys` on linux/macos/windows; assert
   `cargo tree -p bun_spawn_sys` contains no event-loop crates.

## Follow-ups flagged by the EFAULT fix

These call sites still build `Vec<Option<*const c_char>>` and cast it for
execve — same latent bug, different code paths:

- `src/runtime/api/bun/js_bun_spawn_bindings.rs:402,421,1891` (`env_array`, `argv`)
- `src/runtime/cli/test/parallel/{Coordinator.rs:32, runner.rs:285,
Worker.rs:143}` — Worker.rs even has a `// SAFETY: Option<*const c_char>
has the same layout as *const c_char` comment that is **false**.

A `bun_spawn_sys::Argv`/`Envp` newtype would make these unrepresentable.
