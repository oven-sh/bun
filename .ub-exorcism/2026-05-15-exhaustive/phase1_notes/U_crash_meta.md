# Section U: crash-meta-utility (17 paths)

## Purpose

Section U is the cross-cutting utility belt the rest of Bun rests on: the **crash handler** (signal-handler entry, panic hook, dl backtrace, automatic crash-report upload via `bun.report`), **performance instrumentation** (Tracy dlsym vtable, hardware-counter-backed `now_ns`), **platform-specific syscall shims** (Linux splice/FICLONE/epoll_pwait2, macOS mach_time/sysctl/host_statistics64), the **path-handling pool** (`PathBuffer`/`WPathBuffer` 64KB-stack avoidance), the **CLI option model** (`ContextData` with its process-global `*mut Log` aliasing diet), the **file-system watcher** (inotify/kqueue/ReadDirectoryChangesW + thread handoff), the **`which` binary lookup**, the **CLI argument parser** (`bun_clap` + `bun_clap_macros` proc-macro), the **opt-out telemetry** (`bun_analytics`), the **link-time interface dispatch proc-macro** (`src/dispatch/lib.rs` — distinct from runtime `dispatch.rs`), the **peechy schema host** (`src/api/`), and the **binary entry point** (`src/bun_bin/lib.rs` providing `extern "C" fn main`). `src/output/`, `src/bun_output_tags/`, `src/meta/`, `src/clap_macros/`, `src/api/`, `src/node-fallbacks/` contain **0** unsafe sites.

## Per-path unsafe-surface tally (vs prior subtotals)

Prior totals (from `unsafe-inventory.jsonl`, only the 11 named non-zero crates): 202 sites across `bun_crash_handler` (69), `bun_perf` (43), `bun_watcher` (34), `bun_paths` (28), `bun_options_types` (9), `bun_platform` (7), `bun_bin` (5), `bun_which` (3), `bun_dispatch` (2), `bun_clap` (1), `bun_analytics` (1).

| path | site_count | dominant_kind | dominant_bucket |
|---|---:|---|---|
| `src/crash_handler/lib.rs` (+ CPUFeatures.rs) | 83 (+14 vs 69) | signal handlers + panic hook + dl backtrace + report-spawn FFI + Bun__panic exports | **11 (signal-safety)**, 21 (FFI: dladdr/sigaction/_dyld/kernel32) |
| `src/perf/{tracy,lib,hw_timer}.rs` | 71 (+28 vs 43) | Tracy dlsym fn-pointer vtable, RDTSC/CNTVCT inline asm, calibration via `Once` | 18 (transmute_copy of fn ptrs; inline asm), 21 (FFI: clock_gettime/sysctlbyname) |
| `src/platform/{linux,darwin}.rs` | 10 (+3 vs 7) | direct `libc::syscall` (splice / FICLONE / epoll_pwait2), mach_time, host_statistics64 | 21 (raw syscall + Mach FFI) |
| `src/paths/{Path,resolve_path,lib,path_buffer_pool,string_paths}.rs` | 37 (+9 vs 28) | `from_raw` ZStr/WStr reslices, `set_length` family, `assume_init` over fixed-size byte buffers, thread-local UnsafeCell scratch | 1 (Aliasing), 4 (Provenance), 6 (Validity: assume_init), 5 (UnsafeCell) |
| `src/watcher/{Watcher,INotifyWatcher,KEventWatcher,WindowsWatcher,WatcherTrace}.rs` | 37 (+3 vs 34) | inotify/kevent/ReadDirectoryChangesW FFI, `*mut Self` thread-spawn handoff, kernel Event-struct projection | 21 (FFI: inotify/kevent/Win32), 1 (Aliasing: thread-spawn `*mut Self`), 6 (Validity: kernel-padded Event) |
| `src/options_types/{context,schema,compile_target}.rs` | 13 (+4 vs 9) | `*mut Log` accessors (3 `pub unsafe fn`), AtomicPtr<ContextData> publish, `write_int<I: Copy>` raw bytes, `from_utf8_unchecked` of npm name | 1 (Aliasing: `&mut *self.log`), 22 (Send/Sync: AtomicPtr static), 6 (Validity: from_utf8_unchecked) |
| `src/bun_bin/{lib,phase_c_exports}.rs` | 17 (+12 vs 5) | `extern "C" fn main`, init_argv, signal(SIGPIPE/SIGXFSZ), uv_replace_allocator, `Bun__panic` C export | 21 (FFI: libc::signal, libuv allocator wiring) |
| `src/analytics/lib.rs` | 9 (+8 vs 1) | 8 unsafe export/no_mangle ABI attributes + one `libc::sysctlbyname` for macOS `kern.osproductversion` | 21 (FFI / exported symbol ABI) |
| `src/which/lib.rs` | 3 | `ZStr::from_raw_mut` after explicit NUL-write, NLL Polonius `&mut WPathBuffer` reborrow | 6 (Validity: NUL placement), 1 (Aliasing: Polonius reborrow) |
| `src/clap/args.rs` | 2 (+1 vs 1) | `&[&ZStr] → &[&[u8]]` slice cast (sound: `repr(transparent)`) | 1 (Aliasing: layout-equivalent reslice) |
| `src/dispatch/lib.rs` | 15 (+13 vs 2) | proc-macro emitting `unsafe fn` / `unsafe { (*this) }` into consumer crates | n/a — emitted into Sections F/J/K |
| `src/output/`, `src/bun_output_tags/`, `src/meta/`, `src/api/`, `src/clap_macros/`, `src/node-fallbacks/` | **0** | — | — |
| **TOTAL** | **300** | — | — |

Delta vs prior 203: **+97** (≈ +48 %). All deltas are consistent with ongoing port progress and counting-method differences (the `bun_dispatch` count includes proc-macro `quote!{}` strings; the `bun_perf` count includes `unsafe extern "C" fn` type-alias declarations).

## EXP-013 anchor status

### Signal handler entry points

There is **one** POSIX signal entry point, **one** Windows VEH entry point, and
one ordinary Rust panic hook, all funnelling into the same `crash_handler()`
family of reporting code:

| entry | location | signal mask | dispatched to |
|---|---|---|---|
| `handle_segfault_posix` | `src/crash_handler/lib.rs:1657` | registered for SIGSEGV/SIGILL/SIGBUS/SIGFPE via `update_posix_segfault_handler` (line 1686), with `SA_SIGINFO \| SA_RESTART \| SA_RESETHAND` and `sigemptyset` mask | `crash_handler(reason, None, Some(debug::return_address()))` (line 1662) |
| `handle_segfault_windows` | `src/crash_handler/lib.rs:2029` | installed via `AddVectoredExceptionHandler(0, ...)` (line 1756) — Windows VEH; not bound by POSIX async-signal-safety contract but has its own re-entrancy hazards | `crash_handler(reason, None, Some(...))` (line 2064) |
| `rust_panic_hook` (non-signal) | `src/crash_handler/lib.rs:1801` | invoked by `std::panic::set_hook` (line 1792) — runs in panicking thread, *not* under signal delivery, so async-signal-safety does not apply | builds `CrashReason::Panic` and writes via `PANIC_MUTEX.lock()` directly |

Only the **first row** is signal-safety-bound (Bucket 11 / EXP-013). The Windows VEH and the panic hook follow different rules.

### Per-handler async-signal-safe audit (`handle_segfault_posix`)

The POSIX handler reads `(*info).si_addr()` (signal-safe — read of kernel-provided memory), dispatches to `crash_handler(...)`. From there:

| step | function called | async-signal-safe? | evidence |
|---|---|---|---|
| 1 | `bun_core::maybe_handle_panic_during_process_reload()` | unknown - needs T0 audit | `lib.rs:892` |
| 2 | `BEFORE_CRASH_HANDLERS.try_lock()` (Mutex) | **NO** | `lib.rs:897` — `bun_threading::Guarded<Vec<_>>` lock; pthread mutex is not on the POSIX async-signal-safe whitelist |
| 3 | `PANIC_MUTEX.lock()` (Mutex) | **NO** | `lib.rs:904` — same |
| 4 | `Output::flush()` | **NO** | `lib.rs:938` — buffered stderr flush; allocates / locks |
| 5 | `Output::source::stdio::restore()` | **NO** | `lib.rs:939` — restores stdio FDs; may call `dup2` (signal-safe) but also touches Output state under a lock |
| 6 | `writer.write_all(...)` (raw stderr) | **YES** if backed by `write(2)` | `lib.rs:941+` — file-descriptor `write(2)` is on the whitelist |
| 7 | `print_metadata(writer)` (formatting) | **NO** | `lib.rs:953` — not on the POSIX whitelist; reaches ordinary Rust formatting / writer code |
| 8 | `bun_core::ffi::cstr(name)` (strlen-bounded view) | **YES** — calls `strlen` only | `lib.rs:960`, `lib.rs:982` |
| 9 | `Output::pretty_fmt_args(...)` | **NO** | `lib.rs:962+` — builds a runtime rewritten template (`Cow::Owned` via `pretty_fmt_runtime`) and then runs ordinary `Display` formatting |
| 10 | `dump_stack_trace(trace, ...)` (debug-only path) | **NO** | `lib.rs:1184` — symbol resolution via `dladdr` (which itself acquires libc internal locks) and per-frame `format_args!` |
| 11 | `bun_core::reload_process(false, true)` (auto-restart on crash) | **NO** | `lib.rs:1342` — re-execs the process; many non-signal-safe ops in `execve` setup |
| 12 | `report(trace_str_buf.const_slice())` | **NO** | `lib.rs:1316` → `bun_which::which()` (path lookup with `getcwd`) → `libc::fork()` (signal-safe per spec) → `libc::execve(curl)` (signal-safe per spec). The `bun_which::which` path lookup is NOT signal-safe (calls into stat / dirent iteration). |
| 13 | `reset_segfault_handler()` | **YES** — calls `sigaction` (signal-safe) | `lib.rs:1325` |
| 14 | (re-entry on second fault) | SA_RESETHAND mitigates | sigaction installed with `SA_RESETHAND` (line 1737) — the second SIGSEGV on the same thread reaches default disposition (core dump / process termination) |

**Signal-handler invariant violations: 9 of 14 audited steps** are not on the POSIX async-signal-safe whitelist (or 8 operation classes if the two lock calls are grouped). Source confirmation: `src/crash_handler/lib.rs:588` reads:

```rust
// Locked to avoid interleaving panic messages from multiple threads.
// TODO: I don't think it's safe to lock/unlock a mutex inside a signal handler.
// PORTING.md §Concurrency: `bun_threading::Guarded<()>` for a bare critical section.
static PANIC_MUTEX: bun_threading::Guarded<()> = bun_threading::Guarded::new(());
```

The maintainers know. The Zig spec does this too (see `crash_handler.zig` — the `.zig` sibling in the same dir). The Rust port carried it forward intact.

### Verdict

**EXP-013 still applies.** Both characterisations from the prior audit hold:

- The signal handler chains into a mutex, allocating formatters, dl-symbol lookup, and a forked/exec'd path-lookup uploader.
- The only mitigation is `SA_RESETHAND` (line 1737), which converts a second crash on the same thread into immediate termination — preventing the deadlock from manifesting in the common case but not eliminating the hazard.

A Phase-3 experiment shape: **trigger a panic inside the report-upload `bun_which::which` path** (e.g. `getcwd` failing with EFAULT under a hostile mount) and observe whether the handler deadlocks on `PANIC_MUTEX` (re-entry under SA_RESETHAND would reach `t @ (1 | 2)` arm at line 1345, which hits `reset_segfault_handler` + `Output::flush` + a smaller `write!`-based message before falling through). Worth confirming the SA_RESETHAND-mitigated path actually escapes the lock.

A Phase-2 fix sketch: split the signal entry from the report path. The POSIX handler should `write(2)` a fixed pre-formatted message and re-raise. All formatting / dladdr / fork / which / report should run in a sibling thread woken by an `eventfd`/`write(2)` from the signal handler. The existing `BEFORE_CRASH_HANDLERS` queue + mutex would move into the sibling.

## Inline asm enumeration

3 sites, all in `src/perf/hw_timer.rs`:

| line | instruction | clobber list | options | verdict |
|---|---|---|---|---|
| 37 | `mrs {ret}, CNTVCT_EL0` (aarch64) | `ret = out(reg) ret` | `nomem, nostack, preserves_flags` | **correct** — ARM ARM v8 §C5.2.18: MRS to a GPR has no other architectural effect |
| 51 | `rdtsc` (x86_64) | `out("eax") lo, out("edx") hi` | `nomem, nostack, preserves_flags` | **correct** — Intel SDM Vol 2B §RDTSC: writes EAX/EDX only, no flags |
| 154 | `mrs {ret}, CNTFRQ_EL0` (aarch64) | `ret = out(reg) ret` | `nomem, nostack, preserves_flags` | **correct** — same as line 37 |

No `global_asm!`. No `#[target_feature]`-gated SIMD intrinsics in U.

For x86 CPUID, `src/perf/hw_timer.rs:222` deliberately uses `core::arch::x86_64::__cpuid_count` (a `safe fn` intrinsic) instead of raw asm, with PORT NOTE at line 223 citing the LLVM `rbx` PIC base reservation as the reason.

## bun_bin / bun_analytics unsafe sites

### `bun_bin` (17 sites, all in `src/bun_bin/`)

`extern "C" fn main` (line 183) is the entry that resolves crt1.o's undefined `main` symbol — the Cargo staticlib equivalent of Zig's `pub fn main`. All 17 sites are FFI shims:

- `bun_core::init_argv(argc, argv)` (line 188) — captures C-runtime argv before libstd hooks fire (musl-static workaround per docstring).
- `libc::signal(SIGPIPE, SIG_IGN)` and `libc::signal(SIGXFSZ, SIG_IGN)` (lines 196-197) — ignore broken-pipe and file-size-limit signals.
- `bun_sys::windows::libuv::uv_replace_allocator(...)` (line 209) — Windows-only; routes libuv allocations through mimalloc.
- `bun_warn_avx_missing(...)` (line 240) — x86_64 + SIMD + posix; warns if the host CPU lacks AVX.
- `Bun__panic` C export (`phase_c_exports.rs:67-76`) — receives `*const u8 + len` from C++ and forwards to `bun_core::output::panic` after a `core::slice::from_raw_parts` view.

**Nothing unusual.** Each block has a focused SAFETY note. The shape matches Zig's `main.zig` initialization order (sigaction → uv → start_time → argv → output sink → CLI dispatch).

### `bun_analytics` (9 counted sites, in `src/analytics/lib.rs`)

```rust
let rc = unsafe {
    libc::sysctlbyname(
        c"kern.osproductversion".as_ptr(),
        name.as_mut_ptr().cast(),
        &mut len,
        core::ptr::null_mut(),
        0,
    )
};
```

The only runtime unsafe operation here is the `sysctlbyname` call shown above. The other 8 counted sites are unsafe export/no_mangle attributes for C-visible counters/probes (`Bun__napi_module_register_count`, feature counters, and platform probe functions). Reads macOS `kern.osproductversion` into a 32-byte stack buffer for the OS-version field on telemetry pings. Returns `[0u8; 32]` on failure. **No upload-side unsafe in this file** — the actual POST is via `bun_http`, audited under Section Q. The opt-out telemetry surface is otherwise pure-safe Rust.

## Notable patterns

1. **Signal-handler async-signal-safety hazard is comment-acknowledged.** `src/crash_handler/lib.rs:588` carries a TODO admitting the mutex-in-signal-handler hazard. The Zig spec does this too. EXP-013 is not a hidden bug — it is a known-and-accepted carry-over with `SA_RESETHAND` as the only mitigation.
2. **`options_types::context.rs` is the section's safety-comment gold standard.** Three `pub unsafe fn` accessors over a `*mut Log` carry multi-paragraph `# Safety` docs that name every other aliasing path (transpiler, install, JSON parsing, package manager) and explicitly debunk the "`&mut self` proves exclusivity" intuition. This is the right shape any Phase-2 review of process-global mutable state should aspire to.
3. **Inline asm is textbook minimal.** All three `core::arch::asm!` sites use `nomem, nostack, preserves_flags` plus correct out-register declarations. CPUID prefers the safe intrinsic.
4. **Watcher thread-spawn handoff is the cleanest `*mut Self` discipline in U.** `Watcher::start` → `thread::spawn(move || unsafe { Watcher::thread_main(this as *mut Watcher) })` (line 233), with `thread_main` (line 280) carrying a multi-paragraph `# Safety` doc that scopes the `me = &mut *this` borrow strictly before the closing `heap::take(this)`. This is the right shape for Send-boundary `*mut Self` handoffs and matches the EXP-012-style discipline applied in Section F's `WebSocketUpgradeClient::cancel`.

## Open questions

1. **EXP-013 priority.** Phase-3 experiment design: can we Miri-witness or QEMU-witness a deadlock by panicking inside the panic handler under signal delivery? Or does SA_RESETHAND always reach `crash()` first?
2. **Stacked-Borrows status of the Watcher `*mut Self` thread-spawn handoff.** `thread_main` scopes `me = &mut *this` *before* calling `heap::take(this)`. Phase-3 Miri target candidate.
3. **`paths/resolve_path.rs` thread-local `&'static mut`.** `tl_buf_mut` returns `&'static mut [u8; N]` from a thread-local UnsafeCell. Sound by thread-local + UnsafeCell, but same-thread caller must not hold two such borrows simultaneously. Consider Phase-2 review for caller compliance.
4. **`options_types/compile_target.rs:78` `from_utf8_unchecked` of `npm_name()`.** No SAFETY comment at the call site. Phase-2 candidate for explicit ASCII assertion.
5. **`watcher/INotifyWatcher.rs` Event alignment.** Aligned reads rely on kernel padding contract. PORT NOTE names the fallback. Worth a Phase-2 sweep.

## Anchor cross-refs

- **EXP-013 (crash_handler async-signal-safety violations)**: STILL APPLIES.
  - Source TODO confirming hazard: `src/crash_handler/lib.rs:588`.
  - POSIX entry point: `src/crash_handler/lib.rs:1657` (`handle_segfault_posix`).
  - Body that violates async-signal-safety: `src/crash_handler/lib.rs:878-1343` (`crash_handler` fn).
  - Mitigation: `SA_RESETHAND` set at `src/crash_handler/lib.rs:1737`.
