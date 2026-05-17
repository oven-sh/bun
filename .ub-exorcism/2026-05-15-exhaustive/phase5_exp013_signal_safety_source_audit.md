# EXP-013 — POSIX crash signal path calls non-async-signal-safe code

## Verdict

`EXP-013` is closed as `CONFIRMED_UB` in the POSIX / libc contract sense.

This is not a Miri-confirmed Rust abstract-machine witness. It is a source-level
contract proof: Bun's POSIX signal handler calls into substantial code that is
not on the async-signal-safe whitelist before process termination.

## Source path

- `src/crash_handler/lib.rs:1657-1673` installs
  `handle_segfault_posix` for `SIGSEGV`, `SIGILL`, `SIGBUS`, and `SIGFPE`.
- `src/crash_handler/lib.rs:1736-1737` installs it with
  `SA_SIGINFO | SA_RESTART | SA_RESETHAND`.
- The handler calls `crash_handler(...)` at `src/crash_handler/lib.rs:1662`.
- `crash_handler()` starts at `src/crash_handler/lib.rs:878` and reaches
  non-async-signal-safe operations before `crash()` terminates.

Representative non-AS-safe calls on the POSIX signal path:

- `BEFORE_CRASH_HANDLERS.try_lock()` at `src/crash_handler/lib.rs:897`
- `PANIC_MUTEX.lock()` at `src/crash_handler/lib.rs:904`
- `Output::flush()` at `src/crash_handler/lib.rs:938`, `:1339`, `:1350`
- `Output::source::stdio::restore()` at `src/crash_handler/lib.rs:939`
- `print_metadata(writer)` at `src/crash_handler/lib.rs:953`
- `Output::pretty_fmt_args(...)` at `src/crash_handler/lib.rs:965`, `:989`,
  `:1223`, `:1241`
- `dump_stack_trace(...)` at `src/crash_handler/lib.rs:1184`
- `report(...)` at `src/crash_handler/lib.rs:1316`, which reaches
  `bun_which::which(...)` at `src/crash_handler/lib.rs:2923`
- `bun_core::reload_process(false, true)` at `src/crash_handler/lib.rs:1342`

The file itself acknowledges the hazard at `src/crash_handler/lib.rs:587-590`:
the comment says the lock is used to avoid interleaved panic messages, followed
by a TODO that says it is probably not safe to lock/unlock a mutex inside a
signal handler.

## External contract

Local `man 7 signal-safety` says:

```text
An async-signal-safe function is one that can be safely called from within a
signal handler. Many functions are not async-signal-safe. In particular,
nonreentrant functions are generally unsafe to call from a signal handler.
```

It also gives the two safe choices:

```text
(a) Ensure that (1) the signal handler calls only async-signal-safe functions,
and (2) the signal handler itself is reentrant with respect to global variables
in the main program.
```

Bun's current POSIX crash path does not satisfy that rule.

## Evidence artifact

Raw source/audit log:

`phase5_experiment_results/EXP-013-signal-safety-source-audit.log`

## Correct classification

Confirmed:

- The POSIX signal path calls multiple non-async-signal-safe operations.
- `SA_RESETHAND` reduces repeated-handler recursion but does not make the first
  handler body async-signal-safe.
- This can deadlock or corrupt interrupted libc/runtime state depending on where
  the signal interrupts execution.

Not claimed:

- This is not a Miri-reachable Rust Stacked-Borrows / Tree-Borrows trace.
- The ordinary Rust panic hook at `src/crash_handler/lib.rs:1801` is not itself
  a POSIX signal-handler path.
- Windows VEH has a different contract and is not being judged by POSIX
  async-signal-safety rules.

## Remediation direction

Split the signal entry from the report path:

1. POSIX signal handler: use only async-signal-safe primitives (`write(2)` of a
   fixed message, reset/re-raise or `_exit`/trap).
2. Rich reporting path: run formatting, stack walking, path lookup, crash upload,
   and reload logic from a normal thread/context, not from the signal frame.

`EXP-071` remains useful as a regression-prevention vehicle: a static analyzer
that walks signal-handler call graphs and rejects non-whitelisted callees.
