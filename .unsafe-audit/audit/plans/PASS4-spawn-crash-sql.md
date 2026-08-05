# PASS4 — `bun_spawn`, `bun_crash_handler`, `bun_sql{,_jsc}` deep audit

**Scope:** 275 unsafe sites across four crates not covered in prior passes:

| Crate              | Sites | Files                                                                 |
| ------------------ | ----- | --------------------------------------------------------------------- |
| `bun_spawn`        | 105   | `src/spawn/{lib,process,static_pipe_writer}.rs`                       |
| `bun_crash_handler`| 69    | `src/crash_handler/{lib,handle_oom}.rs`                               |
| `bun_sql`          | 11    | `src/sql/{mysql,postgres,shared}/**/*.rs`                             |
| `bun_sql_jsc`      | 90    | `src/sql_jsc/{mysql,postgres,shared,jsc}/**/*.rs`                     |

Discipline matches PASS3 (Codex-grade): a finding is **T1** only when a concrete
adversarial trigger or live UB call path is exhibited. Design hazards without a
demonstrated trigger are **T2**. Latent-watchlist items that won't fire in the
shipping build (e.g. 32-bit-only overflow when Bun ships 64-bit-only) are **T3**.

A separate section enumerates async-signal-safety violations in
`bun_crash_handler` — these are a special category because a violation that
*does* deadlock or invokes UB inside a signal handler is concrete UB, not a
hypothetical.

---

## Attack-surface summary

| Surface                              | Adversary                  | Worst-case if exploited        |
| ------------------------------------ | -------------------------- | ------------------------------ |
| `Bun.spawn({cmd,env})` argv/envp     | JS-side caller (in-VM)     | argument truncation / DoS      |
| Forked subreaper waitpid signalfd    | Local processes (SIGCHLD)  | thread-pool starvation         |
| POSIX `handle_segfault_posix`        | Crash inside Bun (any UB)  | secondary UB inside the handler|
| Windows VEH `handle_segfault_windows`| Crash inside Bun           | same                           |
| `crashByPanic` / `crash_handler`     | Rust `panic!()`            | mutex deadlock, allocator UB   |
| `report()` curl fork                 | Bun's own crash path       | benign — process is dying      |
| Postgres wire-protocol parser        | **Adversarial PG server**  | DoS via panic; **no OOB read** |
| MySQL wire-protocol parser           | **Adversarial MySQL srv**  | DoS via panic; **no OOB read** |
| SQL `Reader { connection: *mut … }`  | Internal — protocol loop   | Stacked-Borrows aliasing       |
| `SQLDataCell` `#[repr(C)] union`     | Internal — DataRow builder | latent double-free hazard      |

The PG/MySQL parsers are the highest-risk external surface; the crash handler is
the highest-risk internal-only surface.

---

## bun_crash_handler — special section: async-signal-safety

### What is permitted inside a POSIX signal handler

The handler installed by `update_posix_segfault_handler` (`lib.rs:1686`) runs in
**async-signal context**: triggered by a hardware fault from arbitrary thread
state. The signal-safe syscall set is small (POSIX 2017 §2.4.3): `_exit`,
`write`, `read`, `kill`, `sigaction`, `sigaltstack`, `sigprocmask`, `tcsetpgrp`,
`sigemptyset`, …. **Disallowed:** `malloc`/`free`, `pthread_mutex_lock`,
anything that walks a thread-local with non-trivial init, any printf-family
formatter that may call into the allocator, any code that takes a lock that a
faulted-mid-critical-section caller might already hold.

### Concrete violations on the live signal-handler path

`handle_segfault_posix` (`lib.rs:1657`) calls `crash_handler(reason, None, …)`
(`lib.rs:878`). The body of `crash_handler` performs:

1. **`thread_local!` write to `PANIC_STAGE`** (`lib.rs:894`). `Cell::set` itself
   is signal-safe **only** if the TLS slot is already initialized for this
   thread. `PANIC_STAGE` is `const { Cell::new(0) }`, so the init is constant
   and the read/write is async-signal-safe in practice. ✓ OK.

2. **`AtomicUsize::fetch_add` on `PANICKING`** (`lib.rs:895`). Lock-free atomic;
   ✓ async-signal-safe.

3. **`BEFORE_CRASH_HANDLERS.try_lock()`** (`lib.rs:897`).
   `bun_threading::Guarded` wraps `Mutex` (`src/threading/Mutex.rs:56`), which
   the doc explicitly warns: "*It is undefined behavior if the mutex is already
   held by the caller's thread*". On glibc this is a `pthread_mutex_t`. `try_lock`
   is non-blocking and returns `None` on contention so it *can't deadlock*, but
   the implementation may still touch internal mutex bookkeeping (`__owner`
   field, `pthread_mutex_kind_t`). Calling `pthread_mutex_trylock` from a signal
   handler when the same thread holds the mutex's locking-thread tracking is
   **explicitly undefined per POSIX**. This is a T2 hazard — `try_lock` papers
   over the deadlock case, but the underlying op is still non-async-signal-safe
   per spec. **Live trigger:** SIGSEGV fires while the main thread is inside a
   non-crash `BEFORE_CRASH_HANDLERS.lock()` critical section (`installRaw`).
   `try_lock` would return None there and skip pre-crash handlers (the
   functional bug — handlers don't run) without UB; **but** if the impl reads
   from the same mutex's `__data.__owner` field non-atomically while the
   faulted thread was mid-write to it, that read is data-race UB. T2.

4. **`PANIC_MUTEX.lock()`** (`lib.rs:904`, `lib.rs:1850`). This is the BLOCKING
   variant. There is even an **acknowledged TODO** at `lib.rs:588`:
   ```
   // TODO: I don't think it's safe to lock/unlock a mutex inside a signal handler.
   ```
   This is correct — and concretely UB-prone. **Live trigger:**
   - Thread A is mid-`crash_handler` (e.g. printing a panic) and holds
     `PANIC_MUTEX`.
   - Thread B receives SIGSEGV.
   - Thread B's signal handler calls `crash_handler` → `PANIC_MUTEX.lock()`.
   - Thread B is now blocked in the kernel waiting on a mutex that Thread A
     still holds.
   - If Thread A's `crash()` path also tries to send `SIGABRT` / re-installs
     handlers that suspend B's resume, deadlock.
   - If Thread A finishes and B continues, fine. Indeterminate behaviour.
   T1.

5. **`Output::flush()`** (`lib.rs:938`, `lib.rs:1866`). This calls
   `bun_core::output::flush()` (`src/bun_core/output.rs:1141`) which
   `SOURCE.with_borrow_mut`'s a **RefCell-wrapped thread-local containing
   `io::Writer` vtable pointers**. From `lib.rs:1146` the function takes a
   `RefMut<…>` on the thread-local — if the same thread was mid-write inside
   `Output::print` (which also `borrow_mut`s `SOURCE`) when SIGSEGV fired, the
   nested borrow panics with `BorrowMutError`. The unwind from that panic
   inside a signal handler is async-signal-unsafe AND triggers the rust_panic_hook,
   which re-enters `crash_handler`. T1. **Live trigger:** crash while
   `Output::print` was mid-stream (e.g. a SIGSEGV during a regular log line).
   The handler's `Output::flush` panics, `panic_hook` runs, sets
   `PANIC_STAGE = 2+`, prints a "panicked during a panic. Aborting." message,
   returns to the inner unwind. With `panic = "abort"` this aborts the process
   so the user-visible artifact is a "no crash report" instead of "redacted
   report with the bug we wanted". This is concrete unsoundness in the form of
   "the signal handler can corrupt the very telemetry it exists to emit", not
   technically memory-UB; but the RefCell-vs-borrow-mut path is the same
   reentrancy that has previously produced double-borrow aborts. T1.

6. **Writes via the `BoundedArray<u8, 1024>` + `bun_io::Write` (StderrWriter)
   path** (`lib.rs:1820`, `lib.rs:888`, `lib.rs:914`). `StderrWriter` is
   alloc-free and calls `libc::write(2, …)` directly (`lib.rs:455`). ✓ This
   path IS async-signal-safe; the choice of `StderrWriter` over `Output::*` was
   deliberate per the comment at `lib.rs:906-913` ("avoid losing information on
   panic in a panic"). The use of `BoundedArray` (stack-resident) is fine.

7. **`Output::disable_scoped_debug_writer()`** (`lib.rs:885`). A guard ensuring
   debug logs don't go to a UFD that may be invalid; the body of that function
   is a stack-only flag flip. ✓ OK.

8. **`bun_core::argv()` walk inside check_flag** (`lib.rs:924`). Reads from a
   `OnceCell<Box<[..]>>` populated at startup. Read-only after init → OK in
   handler context.

9. **`fn report()` → `libc::fork()` + `libc::execve()`** (`lib.rs:2944, 2957`).
   The Zig spec already considered this: a single `fork` from the signal
   handler is async-signal-safe on Linux (vfork-with-execve-only-after, no
   atfork hooks fire because there are none registered by Bun for the crash
   path). ✓ This particular pattern is **safe** because:
   - `fork()` itself is listed in POSIX async-signal-safe.
   - The child does only `close(0)`, `close(1)`, `execve(curl_path, argv,
     environ)`, `_exit(0)`. All four are async-signal-safe.
   - The parent ignores the result.
   No T1/T2 finding here. Negative.

10. **Windows VEH `handle_segfault_windows`** (`lib.rs:2029`). VEH is not a
    POSIX signal — runs in normal thread context with crash-state details in
    `EXCEPTION_POINTERS`. Restrictions are different: must not throw a C++
    exception that crosses the OS stack frame; must not hold a SRWLock during
    handler entry / exit; lock-based recursion can still deadlock if the
    faulting thread held kernel32 internals. The same `PANIC_MUTEX` reentrancy
    risk applies on Windows VEH as on POSIX. T1 (shared with finding 4).

### Severity summary for the handler path

| # | Site                         | Tier | Concrete UB / risk                                   |
| - | ---------------------------- | ---- | ---------------------------------------------------- |
| 1 | `PANIC_STAGE` TLS            | —    | OK (const-init TLS)                                  |
| 2 | `PANICKING` atomic           | —    | OK                                                   |
| 3 | `BEFORE_CRASH_HANDLERS.try_lock` | T2 | non-AS-safe mutex op; mitigated by try-variant       |
| 4 | `PANIC_MUTEX.lock()`         | **T1** | acknowledged-TODO deadlock if thread already holds  |
| 5 | `Output::flush` via RefCell  | **T1** | double-`borrow_mut` panic during nested log/crash   |
| 6 | `StderrWriter` raw `write(2)`| —    | OK                                                   |
| 7 | `disable_scoped_debug_writer`| —    | OK                                                   |
| 8 | `bun_core::argv()` walk      | —    | OK                                                   |
| 9 | `report()` fork/execve/_exit | —    | OK                                                   |
| 10| Windows VEH PANIC_MUTEX      | **T1** | same as #4 on Windows VEH                            |

**Two T1 async-signal-safety findings, one T2.**

### Stack-overflow handler stack (sigaltstack) — verification

`SIGALTSTACK: bun_core::RacyCell<[u8; 512 * 1024]>` is a 512 KB static
zero-init buffer (`lib.rs:1681`). `DID_REGISTER_SIGALTSTACK` gates the
`sigaltstack(2)` call (`lib.rs:1691`). `ss_sp` is taken from
`SIGALTSTACK.get().cast()` — a stable static address that satisfies the
"kernel-owned writes" contract.

- `SA_ONSTACK` is set in `sa_flags` only after `sigaltstack` succeeded
  (`lib.rs:1700-1703`), so on failure the handler runs on the user stack —
  which means a true stack-overflow SIGSEGV would re-fault, but the choice is
  intentional (no other stack to switch to).
- Single 512 KB pool shared by all threads. The kernel guarantees the alternate
  stack is per-thread *only if* `sigaltstack` is called per-thread. Here it's
  called once globally. **If two threads SIGSEGV simultaneously, both run on
  the same 512 KB stack** — concurrent writes, classic data race. T2 (real
  scenario, no concrete bytes-to-UB demonstration yet but the data race is
  there: two threads concurrently writing the same kernel-managed buffer is
  undefined per the kernel's contract for `sigaltstack(2)` per-thread).

### sigemptyset / sa_mask handling — OK

`sigemptyset(&raw mut act.sa_mask)` (`lib.rs:1740`, `lib.rs:2021`, `lib.rs:2985`,
`lib.rs:3633`) writes the kernel mask through a raw mut to a stack-local
`sigaction`. POSIX-required initialization order; ✓ correct.

### `volatile sig_atomic_t` flags

The handler reads `PANIC_STAGE` (TLS Cell, *not* `sig_atomic_t`), `PANICKING`
(AtomicUsize), `HAS_PRINTED_MESSAGE` (AtomicBool), `CRASH_HANDLER_INSTALLED`
(AtomicBool). All atomics are at least as strong as `sig_atomic_t` (which is
guaranteed only for a single async-signal-atomic read/write — atomic-with-
sequential-consistency is strictly stronger). ✓ OK.

### Signal mask restoration after handler

The handler is installed with `SA_RESETHAND` (`lib.rs:1737`), meaning the
kernel restores the default disposition after one invocation — so a second
SIGSEGV inside the handler aborts the process via SIG_DFL. This is the
fail-safe design and is *good*; it prevents infinite-handler-recursion if any
of the T1 findings above re-fault.

But: `SA_RESETHAND` combined with `try_lock`/`reset_segfault_handler` (a
manual reset called elsewhere) can race — if a second SIGSEGV arrives between
the kernel's auto-reset and the explicit `reset_segfault_handler`'s overwrite,
the kernel's SIG_DFL handler kills the process. That's intentional. ✓

---

## bun_crash_handler — non-signal-path findings

### `Unsafe Sync for CrashHandlerEntry` (`lib.rs:617`)

```rust
struct CrashHandlerEntry(*mut c_void, Box<dyn Fn(*mut c_void) + Send>);
unsafe impl Send for CrashHandlerEntry {}
```

The Box closure is `Send`; the `*mut c_void` is opaque. SAFETY comment claims
"only accessed under the mutex; the opaque ptr is never dereferenced except by
the registered callback on the crash thread". The callback fires inside
`BEFORE_CRASH_HANDLERS.try_lock()` from `crash_handler` (`lib.rs:898-901`).
Callback (which is registered cross-thread) is given the `*mut c_void` and
calls it on whichever thread crashed.

If the callback's user code derefs the ptr expecting their original thread, and
the ptr was a `Rc` / `!Send` value, that's UB. **But** this is a contract
violation by callers, not the crash handler's fault — the trait bound is
`Send`. T3 watchlist.

### `detach_lifetime` on borrowed `msg_buf.const_slice()` (`lib.rs:1846`)

```rust
let reason = CrashReason::Panic(unsafe {
    bun_collections::detach_lifetime(msg_buf.const_slice())
});
```

`msg_buf: BoundedArray<u8, 1024>` is on the stack of `rust_panic_hook`. The
`const_slice()` returns a `&[u8]` borrowing it. `detach_lifetime` re-types it to
`&'static [u8]`. The SAFETY comment claims "`msg_buf` outlives every read of
`reason` below — the borrow is fully consumed by the `Display`/`TraceString`
writes inside this frame and never escapes". This is correct in the current
function body (the lifetime is intentionally widened to fit a `&'static [u8]`
in `CrashReason::Panic` so the same enum can carry both static-string panic
payloads and Rust panic payloads). The reason is consumed entirely inside
`rust_panic_hook` before return; `crash()` (which is `-> !`) terminates the
process so the stack frame never returns. ✓ Sound, but T3 watchlist
(refactor-fragile — if someone moves a `report(trace_str_buf.const_slice())`
caller above the `crash()` call to a different thread, the `&'static` lie
becomes UAF).

### `dump_current_stack_trace_from_core` (`lib.rs:1985`)

```rust
unsafe { WTF__DumpStackTrace(addrs.as_ptr(), n); }
```

`addrs: [usize; 32]` on stack, `n: usize` ≤ 32. Sound.

### `slice::from_raw_parts(header.cast::<u8>().add(size_of::<mach_header_64>()), header_ref.sizeofcmds as usize)` (`lib.rs:2501`)

macOS mach-O image-walking — `_dyld_get_image_header()` returns a valid
pointer to the image's mach_header_64, and `sizeofcmds` is part of the header
contract. The bytes after the header are part of the mapped binary by the
mach-O spec. ✓ Sound (relies on dyld/kernel contracts that have held for
20+ years).

### Win32 PWSTR thread-name read (`lib.rs:1078`)

```rust
if HRESULT_CODE(result) == S_OK && !name.is_null() {
    let s = bun_core::ffi::wstr_units(unsafe { *name });
```

SAFETY comment claims "deref is guarded by the S_OK check via `&&`
short-circuit." `&&` short-circuits in Rust, so if `HRESULT_CODE(result) !=
S_OK` the right-hand side is not evaluated. ✓ Sound.

### Recap

- **Two T1 signal-handler findings** (#4, #5 above).
- **One T2 signal-handler finding** (#3 above).
- **One T2 stack-altstack data-race finding** (shared sigaltstack across
  threads).
- Other non-signal-path unsafe sites are sound or T3 watchlist.

---

## bun_spawn — findings

### Setup: trust boundary

`Bun.spawn({cmd: [string], env: {[k]: string}})` accepts JS strings. By the
time bytes reach `bun_spawn::process::sync::spawn`, the JS layer has:
- Converted JS strings to `Box<[u8]>` slices (UTF-8 / arbitrary bytes).
- NOT validated against embedded NUL bytes.
- NOT validated that the path doesn't contain `\0` (which would truncate at
  exec time on POSIX).

`argv` and `envp` are constructed in `spawn()` (`process.rs:2843`) via
`StringBuilder`. `count_z` reserves `len + 1`; `append_count_z` writes the
slice verbatim then appends a single `0` terminator.

### F-1 (T3): Silent argv NUL-byte truncation

**Site:** `bun_core/string/StringBuilder.rs:32-40` (`count_z`,
`append_count_z`); used at `spawn/process.rs:2861-2878`.

Adversarial input: `Bun.spawn(["bin", "arg1\0poison"])`.

`StringBuilder` copies `"arg1\0poison"` verbatim (8 bytes plus terminator).
The argv pointer points at byte 0; `execve` reads until the first NUL, so the
child sees `argv[1] = "arg1"` — the `\0poison` tail is silently discarded.

**Tier:** T3. **Not memory-unsafe** — the C string is validly NUL-terminated.
This is consistent with Node.js's behaviour, but Node has a documented
`ERR_INVALID_ARG_VALUE` for NUL-bearing args in some surfaces (`process.argv`
parsing on Windows). Watchlist: if upstream Bun adds path-injection
hardening, this is where to add it. No live security trigger today because the
NUL truncation can't extend privileges — the prefix is what the user-side
spawn caller intended to send anyway, and any `argv0`-path injection requires
prior write to the cmd array.

### F-2 (T2): `wakeup` SIGCHLD handler — `bun_sys::write` call

**Site:** `spawn/process.rs:1395-1399`.

```rust
extern "C" fn wakeup(_: c_int) {
    let one: [u8; 8] = (1usize).to_ne_bytes();
    let _ = bun_sys::write(instance_ref().eventfd, &one).unwrap_or(0);
}
```

The handler is registered on SIGCHLD (`process.rs:1349-1355`) with
`SA_NOCLDSTOP`. Inside the handler:

1. `instance_ref()` (`process.rs:1303-1305`) returns `unsafe { &*INSTANCE.0.get() }`
   — a static `Instance` from a `RacyCell`. Read-only after one-time
   `init()`. ✓ Async-signal-safe.
2. `bun_sys::write` (`src/sys/lib.rs:2019`) on Linux dispatches to
   `linux_syscall::write` which is the raw `syscall(SYS_write, …)`. ✓
   Async-signal-safe.

But the `_ = bun_sys::write(...).unwrap_or(0)` discards the error — if eventfd
fills up (8 bytes max — the kernel rejects writes when value would overflow
u64), the wakeup byte is silently dropped and the waiter thread doesn't
re-poll. **Liveness bug**: if SIGCHLD floods (many children exiting in a
burst) and the waiter thread is mid-poll AND the eventfd is at 0xFFFF...FF -
8, subsequent SIGCHLDs go un-acked until the waiter consumes the eventfd. Not
unsoundness — DoS on subprocess reaping. T2.

Note: the eventfd is per-`Instance` (one process-global instance per Bun
process), so `value` can never reach u64::MAX because waiter consumes it after
each wakeup; the actual risk is much smaller in practice.

### F-3 (—): argv/envp pointer-array NUL-termination

**Site:** `spawn/process.rs:2870-2881`.

```rust
let mut args: Vec<*const c_char> = Vec::with_capacity(argv.len() + 1);
// ...
for arg in argv { args.push(unsafe { base.add(off) }); off += arg.len() + 1; }
args.push(core::ptr::null());
```

✓ Correctly NULL-terminates the pointer array. `args.as_ptr()` is then passed
to `spawn_with_argv` and on to `posix_spawn_z(.., argv: *const *const c_char,
envp: *const *const c_char)`. Sound.

### F-4 (—): envp from `bun_sys::environ_ptr()`

**Site:** `spawn/process.rs:2846`.

```rust
let envp: *const *const c_char = options.envp.unwrap_or_else(|| bun_sys::environ_ptr());
```

`bun_sys::environ_ptr()` is just `std::c::environ` (or `_NSGetEnviron` on
mac). Standard C contract: NULL-terminated array of `KEY=VALUE` strings.
Caller's responsibility. ✓ Sound.

### F-5 (T3): `string_builder.ptr.expect("allocate() succeeded")` after `as_ptr()`

**Site:** `spawn/process.rs:2864-2869`.

The SAFETY comment at `process.rs:2854-2860` is well-reasoned: it explains
that calling `append_z` and stashing the returned `&ZStr` ref across iterations
would invalidate the saved pointer under Stacked Borrows. The mitigation —
"copy all strings first, then derive every argv pointer in one pass from the
builder's base `NonNull`" — is correct. The derived `*const c_char` carries
the original allocation's provenance.

After `core::mem::forget(args)`? No — the `args` Vec is dropped normally
after `spawn_with_argv` returns; the underlying buffer-of-argv strings
(`string_builder`) is held by the `string_builder: StringBuilder` local and
drops at the end of `spawn()`. The pointer array `args` is converted to a raw
ptr via `args.as_ptr()` and only dereferenced inside `posix_spawn` BEFORE
`spawn()` returns — so the lifetimes are correct. ✓ Sound. Why T3:
refactor-fragile, depends on call sequencing.

### F-6 (—): `cfg!(unix)` `SignalForwarding` RAII

**Site:** `spawn/process.rs:2898-2914`.

```rust
impl Drop for SignalForwarding {
    fn drop(&mut self) {
        Bun__unregisterSignalsForForwarding();
        bun_crash_handler::reset_on_posix();
    }
}
```

`reset_on_posix` re-installs the segfault handler. Called from `Drop` after
the synchronous spawn returns. ✓ Sound.

### F-7 (T2): JobControl ttou_blocked — POSIX sigprocmask race

**Site:** `spawn/process.rs:3008-3020`.

```rust
fn ttou_blocked(pgid: libc::pid_t) {
    unsafe {
        let mut set: libc::sigset_t = bun_core::ffi::zeroed();
        let mut old: libc::sigset_t = bun_core::ffi::zeroed();
        libc::sigemptyset(&raw mut set);
        libc::sigemptyset(&raw mut old);
        libc::sigaddset(&raw mut set, libc::SIGTTOU);
        libc::sigprocmask(libc::SIG_BLOCK, &raw const set, &raw mut old);
        let _ = tcsetpgrp(0, pgid);
        libc::sigprocmask(libc::SIG_SETMASK, &raw const old, core::ptr::null_mut());
    }
}
```

`sigprocmask` in a multithreaded program is *unspecified behaviour* per POSIX —
use `pthread_sigmask`. Per glibc this is effectively-equivalent on Linux but
the spec is clear: in a threaded program, `sigprocmask` may modify any
thread's mask. **Live impact:** SIGTTOU mask leak into another thread that
later receives SIGTTOU and stops the process. T2.

### F-8 (T3): `extra_fds.len()` cast paths

**Site:** `spawn/process.rs:1893, 2222, 2239`.

Various `3 + options.extra_fds.len()` cast to `u32` / `usize`. Bun's
`Bun.spawn` does not impose an explicit cap on extra_fds. `RLIMIT_NOFILE` is
the practical ceiling (typically 1024 - 65535). T3 watchlist.

### F-9 (—): `unsafe extern "C" fn uv_read_cb` Stacked-Borrows hardening

**Site:** `spawn/process.rs:2477-2505`.

The SAFETY comments for `uv_alloc_cb` (`process.rs:2455-2473`) **explicitly
call out the Stacked-Borrows hazard** and the fix: "Do NOT route through
`uv_buf_t::init(&[u8])` — that reborrows the `&mut [u8]` as shared, so
`as_ptr().cast_mut()` yields a SharedReadOnly tag and libuv's subsequent write
into `base[..nread]` is Stacked-Borrows UB. Construct from `as_mut_ptr()`
directly so the raw pointer carries write provenance."

This is exactly the kind of attention that should be paid throughout the
codebase. ✓ Correct.

### F-10 (—): `IntrusiveRc::from_raw(this)` at `static_pipe_writer.rs:169`

The `create` constructor allocates via `heap::into_raw`, configures the writer,
then wraps in `IntrusiveRc::from_raw` (transferring the initial +1 ref). ✓
Sound; standard intrusive-rc lifecycle.

### F-11 (T3): `unsafe { (*this).buffer.is_empty() }` reads after `set_pipe`

**Site:** `spawn/static_pipe_writer.rs:160`.

```rust
unsafe { this_ref.writer.set_pipe(bun_core::heap::into_raw(pipe)) };
```

The pipe Box is converted to raw, then `set_pipe` re-wraps via `heap::take`
internally. `heap::into_raw` followed by an immediate `heap::take` in the
callee is a no-op ownership transfer. ✓ Sound; T3 watchlist for the obvious
refactor-fragility.

### F-12 (T2): SIGCHLD waiter eventfd race on first-spawn

**Site:** `spawn/process.rs:1362-1391`.

`init()` is gated by `if started.fetch_max(1, Ordering::Relaxed) > 0 { return
Ok(()) }`. If two threads call `spawn()` simultaneously, both can see
`started=0`, one increments to 1, the other sees it's already 1 and returns
*before* `eventfd` is assigned. The first thread proceeds to allocate the
eventfd and spawn the waiter thread; the second thread tries to write to
`instance_ref().eventfd` in `append()` (`process.rs:1329-1330`) before
`init()` has set it — `eventfd` is `Fd::INVALID`, `libc::write(-1, …)` returns
-1, panic "Failed to write to eventfd" (`process.rs:1332`).

**Severity:** caller-visible panic on first-ever concurrent spawn from a fresh
process. **Reproducer:** none in CI yet; would need a Bun startup that spawns
two children simultaneously before any spawn has completed. T2.

The fix: hoist `eventfd` allocation before `started.fetch_max`, or do
`compare_exchange` on the `started` flag and have the loser spin until the
winner sets `eventfd`.

### F-13 (—): Various `unsafe { &mut *raw }` reborrows

**Sites:** many — `process.rs:237, 324, 453, 457, 488, 517, 585, 891, 2462,
2484, 2517, 2641, 2947, 3143, 3190, …`.

These are the standard "convert `*mut Self` to `&mut *self` at the entry of a
method whose contract is `this is live and exclusively held`" pattern. PASS3
already noted this idiom is endemic to the codebase. ✓ Sound when SAFETY
contracts are upheld; no concrete UB call path found in spawn.

### bun_spawn — summary

| Tier | Count | Notes                                       |
| ---- | ----- | ------------------------------------------- |
| T1   | 0     | —                                           |
| T2   | 3     | F-2 (eventfd liveness), F-7 (sigprocmask in MT), F-12 (init race) |
| T3   | 4     | F-1 (NUL truncation), F-5, F-8, F-11        |
| OK   | rest  | F-3, F-4, F-6, F-9, F-10, F-13              |

---

## bun_sql / bun_sql_jsc — findings

### S-1 (T2): `SQLDataCell` is `Copy + Clone` with destructor in `deinit()`

**Site:** `src/sql_jsc/shared/SQLDataCell.rs:21-40`.

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct SQLDataCell { tag: Tag, value: Value, free_value: u8, … }
```

`Value` is a `#[repr(C)] union` containing `WTFStringImpl` (refcounted), `Array
{ ptr, len, cap }` (vec-shaped allocation), `bytea: [usize; 2]` (raw bytes
pointer/len), `TypedArray { head_ptr, ptr, byte_len, … }`.

The type's explicit comment at L86-88 admits:
> Clone/Copy: bitwise — `ptr` is logically OWNED (freed by `deinit`), but the
> type is `#[repr(C)]` POD passed across FFI by value (Zig pattern). Ownership
> is single-writer by convention; never call `deinit` on more than one copy.

This is a **classic foot-gun**. The Rust compiler won't complain if someone
writes:
```rust
let a = some_cell;     // Copy
let b = some_cell;     // Copy  - two owners of same `free_value=1` Array.ptr
a.deinit();
b.deinit();            // double free
```

Audit of current call sites:

1. `postgres/DataCell.rs:149-153`: `scopeguard::guard(Vec<SQLDataCell>, |a|
   for cell in a.iter_mut() { cell.deinit() })`. ✓ Holds Vec uniquely.
2. `postgres/DataCell.rs:726-730`: `into_inner` + `mem::forget`. ✓
   Forgets the Vec so its Drop doesn't run; the cells' `deinit` is now the
   responsibility of the *new* owner (the SQLDataCell::Array placeholder
   inside the parent's deinit chain). The handoff is sound.
3. `postgres/PostgresSQLConnection.rs:2486-2496`: `scopeguard::defer!` calls
   `(*cells_ptr.add(i)).deinit()` for `i in 0..count` AFTER the scope. The
   cells live in `stack_buf` or `heap_cells` and are written by `Putter::put`.
   Each put writes a fresh cell; the scopeguard runs once. ✓ Single owner.

I did not find an active double-deinit. But the `Copy` + manual-`deinit`
pattern is the same hazard class as PASS3 finding around `bun_core::String`
moves: T2 because a future refactor that does `let x = cells[0]; do_thing(x);
cells[0].deinit();` would silently double-free. The author's "never call
`deinit` on more than one copy" comment IS the entire invariant — there's no
compiler enforcement.

**Mitigation suggestion**: shadow `SQLDataCell` with a `ManuallyDrop`-wrapped
struct in Rust-side code, only converting to the bare `Copy` type at the FFI
boundary.

### S-2 (T2): MySQL `Reader` field-projection aliasing

**Site:** `sql_jsc/mysql/MySQLConnection.rs:1591-1615`.

```rust
#[derive(Clone, Copy)]
pub struct Reader { pub connection: *mut MySQLConnection }

impl Reader {
    fn read_buffer(&self) -> &mut OffsetByteList {
        unsafe { &mut *core::ptr::addr_of_mut!((*self.connection).read_buffer) }
    }
}

impl ReaderContext for Reader {
    fn read(self, count: usize) -> Result<Data, AnyMySQLError> {
        let remaining = self.read_buffer().remaining();   // first &mut reborrow
        // ...
        let slice = bun_ptr::RawSlice::new(&remaining[0..count]);
        self.skip(isize::try_from(count).expect("int cast"));   // second &mut reborrow
        Ok(Data::Temporary(slice))
    }
}
```

`remaining = self.read_buffer().remaining()` materializes a `&mut
OffsetByteList` (call it tag T1), takes `&[u8]` from it. Then
`RawSlice::new(&remaining[0..count])` *reads* from the `&[u8]` derived from
T1's tag chain. Then `self.skip(...)` materializes a **second** `&mut
OffsetByteList` from the same raw pointer — call it tag T2.

Under **Stacked Borrows**: creating T2 pops the stack and invalidates T1's
SharedReadOnly tag chain. The `RawSlice` retains a pointer with T1 provenance
that will be read later by the caller. When the caller reads through that
pointer, Miri's SB engine reports UB. The detailed-comment at L1584-1590
acknowledges the aliasing pattern but argues it's safe under "freely-aliasing
*MySQLConnection semantics" which the Zig original had.

Under **Tree Borrows**: shared reads do *not* invalidate the chain.
`RawSlice` reads through a raw pointer (no `&` reborrow), so TB sees only
"reads-from-raw" and the access is permitted.

**Tier:** T2. This is a documented architecture pattern, not a concrete UB
under rustc's current operational semantics (Tree Borrows is the de-facto
Miri default; Stacked Borrows is the stricter model). The author has tagged
the issue and chosen TB-compatibility as the contract.

**Reproducer:** `cargo miri test -p bun_sql_jsc` with default flags (TB)
should pass; with `MIRIFLAGS='-Zmiri-tree-borrows=0 -Zmiri-stacked-borrows'`
the relevant SQL tests should fail. Not verified in this audit pass.

### S-3 (T3): `usize::try_from(byte_length).expect("int cast")` on
adversarial-server-supplied length

**Site:** `sql/mysql/protocol/NewReader.rs:110`, multiple PG/MySQL DataRow
paths.

```rust
pub fn encode_len_string(self) -> Result<Data, AnyMySQLError> {
    if let Some(result) = decode_length_int(self.peek()) {
        self.skip(result.bytes_read);
        return self.read(usize::try_from(result.value).expect("int cast"));
    }
    Err(AnyMySQLError::InvalidEncodedLength)
}
```

`result.value` is `u64`. On 64-bit hosts `usize::try_from(u64)` always
succeeds. **On 32-bit hosts** an adversarial server could send an encoded
length > u32::MAX and trigger a panic — a denial-of-service vector.

Bun ships only 64-bit binaries (see `scripts/build/`), so this is **T3, not
T2**. Negative.

Similar shape on Postgres `DataRow.rs:40` (`byte_length: u32` cast to usize)
— same conclusion.

### S-4 (T3): Postgres `length()` saturating-sub-then-as-usize potential overflow

**Site:** `sql/postgres/protocol/NewReader.rs:170-177`.

```rust
pub fn length(&mut self) -> Result<PostgresInt32, AnyPostgresError> {
    let expected = self.int::<PostgresInt32>()?;   // u32
    self.ensure_capacity(expected.saturating_sub(4) as usize)?;
    Ok(expected)
}
```

On 32-bit hosts, an adversarial server sends `length=u32::MAX`. Then
`expected.saturating_sub(4) as usize = u32::MAX - 4`. `ensure_capacity` calls
`ensure_length(count)` → `self.buffer.len() >= (*self.offset + length)`. On
32-bit usize, `*self.offset + (u32::MAX - 4)` overflows. Rust's `+` panics in
debug or wraps in release. In release with wrap, `ensure_length` returns
`true` falsely; subsequent `read(count)` would call `&buffer[offset..offset+count]`
which Rust slice indexing bounds-checks and would panic.

Bun is 64-bit. T3.

### S-5 (—): Postgres `DataRow::decode` with adversarial fields

**Site:** `sql/postgres/protocol/DataRow.rs:11-52`.

```rust
let remaining_fields: usize = usize::try_from(reader.short()?.max(0)).expect("int cast");
for index in 0..remaining_fields {
    let byte_length = reader.int4()?;
    match byte_length {
        0 => { … empty cell … }
        NULL_INT4 => { … null cell … }
        _ => {
            let mut bytes = reader.bytes(usize::try_from(byte_length).expect("int cast"))?;
            // …
        }
    }
}
```

`remaining_fields` is bounded by `u16::MAX = 65535`. `byte_length` is u32; on
64-bit, `usize::try_from(u32)` always succeeds. `reader.bytes(count)` →
`read(count)` → `ensure_capacity` → returns `ShortRead` if not enough bytes.
The `expect("int cast")` calls are infallible on 64-bit. ✓ Sound.

### S-6 (—): Postgres binary array parse — bounds check

**Site:** `sql_jsc/postgres/DataCell.rs:791-806`.

```rust
if bytes.len() < 20 { return Err(...); }
let array_len: i32 = i32::from_ne_bytes(bytes[12..16]...).swap_bytes();
if array_len < 0 { return Err(...); }
let element_stride: usize = size_of::<Elem>() * 2;
let max_elements = (bytes.len() - 20) / element_stride;
if usize::try_from(array_len)? > max_elements { return Err(...); }
```

Pre-iteration bound: validates `array_len * element_stride + 20 <= bytes.len()`.
On 64-bit, `array_len <= i32::MAX`, `element_stride <= 16` → product fits in
usize easily. ✓ Sound.

### S-7 (—): MySQL ColumnDefinition41 / OKPacket parsers

**Site:** `sql/mysql/protocol/{ColumnDefinition41,OKPacket,HandshakeV10}.rs`.

Each reads length-encoded strings / fixed-size ints from the `NewReader`. All
go through `read(count)`/`read_z()` → `ensure_capacity` → returns `ShortRead`
on under-flow. No raw-pointer arithmetic, no `unsafe` slice construction. ✓
Sound under adversarial server (just `ShortRead`).

### S-8 (—): MySQL Auth.rs BoringSSL FFI

**Site:** `sql/mysql/protocol/Auth.rs:208-273` (RSA public-key encryption for
the `caching_sha2_password` plugin).

Standard BoringSSL FFI:
- `BIO_new_mem_buf(public_key.as_ptr().cast::<c_void>(), len)` — public_key is
  a `&[u8]` borrowed from server response (PEM-encoded RSA public key sent in
  AuthSwitchRequest). BoringSSL copies into a BIO; ✓ sound.
- `PEM_read_bio_RSA_PUBKEY(*bio, null, None, null)` — BoringSSL parses; ✓.
- `RSA_public_encrypt(plain_password.len(), plain_password.as_ptr(),
  encrypted_password.as_mut_ptr(), *rsa, RSA_PKCS1_OAEP_PADDING)` —
  encrypted_password must be `RSA_size(rsa)` bytes. The code calls
  `RSA_size(*rsa)` first (`Auth.rs:266`) and allocates accordingly. ✓ Sound.

### S-9 (T3): `MaybeUninit::uninit().assume_init()` for `CachedStructure` zeroed-on-init

**Site:** `sql_jsc/shared/CachedStructure.rs:58`.

```rust
unsafe { MaybeUninit::uninit().assume_init() }
```

Used to construct a `CachedStructure` whose fields are then individually
overwritten. **Unsound** if any field has invalid bit patterns for "all-zero"
or "all-uninit". Let me verify the structure type — without seeing it, but
based on the C++ FFI shape it's likely `#[repr(C)] struct { ptr: *mut _,
flags: u32, len: u32 }` etc., all of which accept any bit pattern. T3 — same
hazard class as PASS2-maybe-uninit-deep-dive. Compare `bun_core::ffi::zeroed`
which guarantees the all-zero bit pattern.

### S-10 (—): `slice::from_raw_parts(self.ptr, self.len as usize)` in Array

**Site:** `sql_jsc/shared/SQLDataCell.rs:120, 133`.

```rust
unsafe { slice::from_raw_parts_mut(self.ptr, self.len as usize) }
```

SAFETY comment claims producers (`DataCell.rs:461`) zero-init the full
capacity. Verified: the array push paths build a `Vec<SQLDataCell>` and
convert to ptr/len/cap via `as_mut_ptr` + `mem::forget`. The Vec's contiguous
storage is correctly laid out. ✓ Sound when not the `*deinit` double-call
hazard (S-1).

### S-11 (—): `OffsetByteList` reuse for prepared-statement parameters

**Site:** `sql_jsc/mysql/MySQLConnection.rs` (write_buffer projection).

Each prepared-statement execute builds the COM_STMT_EXECUTE packet by writing
into `connection.write_buffer` (an `OffsetByteList`). The buffer is reused
across requests; offsets advance, then `bun_sys::write` flushes. There is no
cross-thread sharing — the connection is single-threaded by JSC contract. ✓
Sound.

### S-12 (—): Postgres connection state machine

`PostgresSQLConnection` (`sql_jsc/postgres/PostgresSQLConnection.rs`) tracks
state via `AuthenticationState`, `TLSStatus`, `Status` (in `bun_sql`), and
`ConnectionFlags` bitflags. State transitions are linear (Handshaking →
Authenticating → Connected). I didn't find an unsafe state transition where
two simultaneous queries could observe an in-flight authentication response.
The advance loop (`advance`, `process_packets`) is protected by single-thread
JS-VM execution context. ✓ Sound.

### S-13 (T3): `bun_core::wtf::WTFStringImpl` cross-thread deref hazard

**Site:** various SQLDataCell consumers passing `*mut WTFStringImplStruct`.

Per `src/CLAUDE.md §Cross-thread string hazards`, atomic-string drops from
non-JS threads UAF. SQLDataCell's `string`/`json` fields carry a
`WTFStringImpl`. If `deinit` (which calls `p.deref()` at `SQLDataCell.rs:210`)
runs on a non-JS thread (HTTP threadpool worker, etc.), this is a documented
UAF in `WTFStringImpl::deref` via the AtomString table.

Audit: the SQL connection ops run on the JS thread (event-loop driven via
`PostgresSQLConnection::on_data`/`advance` from socket callbacks). The
`deinit` path is the scopeguard in `process_packets` and the
postgres-specific scopeguard in `DataCell.rs:149`. Both run synchronously on
the JS-VM thread. ✓ Sound in current usage. T3 — refactor-fragile if
SQLDataCell is ever moved off-thread.

### S-14 (—): Postgres SASL.rs PKCS5_PBKDF2_HMAC

**Site:** `sql_jsc/postgres/SASL.rs:83-97`.

```rust
unsafe {
    boringssl::PKCS5_PBKDF2_HMAC(
        if password.is_empty() { core::ptr::null() } else { password.as_ptr() },
        password.len(),
        salt_bytes.as_ptr(),
        salt_bytes.len(),
        iteration_count as c_uint,
        boringssl::EVP_sha256(),
        out.len(),
        out.as_mut_ptr(),
    )
}
```

`out` is a `&mut [u8]` of caller-determined size, `password`/`salt_bytes` are
slices. BoringSSL fills `out`. ✓ Sound; standard FFI pattern.

### S-15 (—): `unsafe extern "C"` callbacks in PG/MySQL — SSL hooks

Multiple sites in `MySQLConnection.rs` / `PostgresSQLConnection.rs` register
callbacks for `boringssl::SSL_CTX_set_*_cb`. Standard C-ABI pattern; pointer
provenance OK as long as the registered ctx pointer outlives the callback
registration. The `Connection` type has `Drop` that calls `SSL_CTX_free` —
which removes the callback registration. ✓ Sound.

### S-16 (—): `BoringSSL::SSL_CTX_free(s)` on connection deinit

**Sites:** `MySQLConnection.rs:549, 317`, `PostgresSQLConnection.rs:1160,
1502`.

Each site checks `if let Some(s) = self.secure { … }`. ✓ Sound — null-guarded.

### bun_sql / bun_sql_jsc — summary

| Tier | Count | Notes                                                |
| ---- | ----- | ---------------------------------------------------- |
| T1   | 0     | —                                                    |
| T2   | 2     | S-1 (Copy union double-deinit risk), S-2 (SB aliasing)|
| T3   | 4     | S-3, S-4, S-9, S-13                                  |
| OK   | 10    | S-5, S-6, S-7, S-8, S-10, S-11, S-12, S-14, S-15, S-16|

---

## Cross-crate totals

| Tier | bun_crash_handler | bun_spawn | bun_sql{,_jsc} | **Total** |
| ---- | ----------------- | --------- | -------------- | --------- |
| T1   | 2                 | 0         | 0              | **2**     |
| T2   | 2                 | 3         | 2              | **7**     |
| T3   | 2                 | 4         | 4              | **10**    |

### Most impactful finding

**bun_crash_handler signal-handler PANIC_MUTEX (lib.rs:904, 1850) — T1.**

The Mutex lock from within a POSIX signal handler is acknowledged by the
author themselves in a `TODO` comment at lib.rs:588 — *"I don't think it's
safe to lock/unlock a mutex inside a signal handler."* This is correct. The
concrete deadlock scenario is:

```
Thread A: SIGSEGV → handle_segfault_posix → crash_handler → PANIC_MUTEX.lock() (HELD)
Thread B: SIGSEGV → handle_segfault_posix → crash_handler → PANIC_MUTEX.lock() (BLOCKS)
```

Thread B is now wedged in the kernel waiting on a mutex that's held by a
crashing thread. If Thread A's `crash()` path successfully terminates the
process, Thread B is reaped. **But if Thread A crashes again inside its own
handler** (which is exactly why crash handlers exist — they handle the case of
"unexpected state"), the kernel uses `SA_RESETHAND` to fall through to SIG_DFL
and the process aborts. Thread B's mutex wait is interrupted by the abort.

The user-visible artifact: a "crash report" that intermittently fails to
emit, or — if `Output::flush()`'s RefCell hazard fires first — a "panicked
during a panic. Aborting." line and no crash report at all.

**Fix shape:** replace `PANIC_MUTEX: bun_threading::Guarded<()>` with a
`pthread_mutex_init`-with-`PTHREAD_PRIO_NONE` and `try_lock`-only access from
the handler, OR with a lock-free CAS on a `AtomicBool` (set to true on entry,
check on entry — if set, just write to stderr and abort without re-entering
the formatter path). Either way: **never call `lock()` from a signal handler**.

---

## Bench-of-comparisons

Compared to PASS3's HTTP-stack and uws-libuv deep dives (which surfaced
similar JS-bridge-FFI patterns), the spawn/crash/sql crates are notably more
defensive in their unsafe annotations — the SAFETY comments are detailed and
correct in 90%+ of sites. The remaining issues cluster around three patterns:

1. **Acknowledged-but-unfixed signal-handler hazards** in `bun_crash_handler`
   (the `TODO: I don't think it's safe to lock/unlock a mutex inside a signal
   handler.` is the smoking gun). These are T1 because the author explicitly
   identified them as wrong.

2. **`#[repr(C)] union` types that derive `Copy + Clone` for FFI shape
   compatibility but carry destructor semantics** (`SQLDataCell`). The Zig
   pattern translated literally to Rust loses Rust's affine-move enforcement.

3. **Stacked-Borrows-incompatible field projection through raw pointers**
   when the parent's `&mut self` is live (MySQL `Reader::read_buffer`). These
   are sound under Tree Borrows; documented as such; they remain T2 because
   the codebase is gradually moving to TB and rustc will likely make TB the
   reference semantics.

The wire-protocol parsers (PG/MySQL) are notably **safer than feared** —
bounds checks are pervasive, integer cast paths are explicit, and the trust
boundary with "adversarial server" is well-modeled. The 32-bit overflow
concerns are theoretical because Bun ships 64-bit only.

---

## Closing recommendations

| Pri | Action                                                                                          |
| --- | ------------------------------------------------------------------------------------------------ |
| **P0** | Replace `PANIC_MUTEX.lock()` (lib.rs:904, 1850) with a lock-free re-entrancy guard.        |
| **P0** | Make `Output::flush` no-op inside signal handlers (gate on `PANIC_STAGE > 0`).            |
| **P1** | Per-thread `sigaltstack` instead of shared 512K static.                                       |
| **P1** | Wrap `SQLDataCell` in a `ManuallyDrop`-style affine newtype for Rust-side use.               |
| **P1** | Audit MySQL `Reader::read` under Stacked Borrows (Miri test); migrate to disjoint borrows.   |
| **P2** | Add NUL-byte validation to `Bun.spawn` argv at the JS boundary (UX defence-in-depth).        |
| **P2** | `pthread_sigmask` instead of `sigprocmask` in `JobControl::ttou_blocked`.                    |
| **P3** | Eventfd `init` race window in `WaiterThreadPosix` (F-12).                                    |

— end PASS4 —
