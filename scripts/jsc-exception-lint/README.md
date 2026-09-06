# jsc-exception-lint

A static checker for JavaScriptCore exception discipline in Bun's C++ code.
It finds the same class of bug that `BUN_JSC_validateExceptionChecks=1`
finds at run time, without needing a test to execute the path.

## Run

```sh
bun scripts/jsc-exception-lint/run.ts                 # whole tree
bun scripts/jsc-exception-lint/run.ts src/jsc/bindings/BunObject.cpp
bun scripts/jsc-exception-lint/run.ts --kind pending-call,thrown-call
bun scripts/jsc-exception-lint/rust-externs.ts        # Rust externs vs C++ summaries
```

It needs a configured debug build (`build/debug/compile_commands.json` and
the generated headers) and the LLVM 21 development package (`libclang-cpp`,
`clang/` headers). Set `LLVM_DIR` if it is not under `/usr/lib/llvm-21`.

The first run also parses the JavaScriptCore sources under `vendor/WebKit`
to learn which JSC functions can throw. That takes about ten minutes and is
cached in `build/debug/jsc-exception-lint/` per WebKit version.

## What it checks

JSC's validator works like this. Every function that can throw declares a
`ThrowScope`. When a callee's scope is destroyed it sets
`VM::m_needExceptionCheck`. The next `ThrowScope` constructor, and the next
non-released `ThrowScope` destructor, assert that the bit is clear. Only
`exception()` (which `RETURN_IF_EXCEPTION` expands to), `clearException()`
and the `assertNoException` family clear it.

The tool models that state machine over the clang CFG of every function. The
abstract state is a set over `{clean, pending, thrown} x {released}`. A call
to a callee that can throw moves the state to `pending`. A call to a thrower
(`throw*`, `Bun::ERR::*`, `ThrowScope::throwException`) moves it to `thrown`.
A check moves it to `clean`. `scope.release()` sets `released`.

Kinds of finding:

- `pending-call`: a callee that can throw is called while a check is
  pending. The validator asserts here when the callee declares a scope. In
  release the second call runs with the first exception still set and may
  overwrite it.
- `unchecked-exit`: the function returns while a check is pending and its
  scope was not released. The validator asserts in the destructor. Use
  `RETURN_IF_EXCEPTION` or `RELEASE_AND_RETURN`.
- `scope-while-pending`: a `ThrowScope` is constructed while a check is
  pending. Usually a second `DECLARE_THROW_SCOPE` in a function that already
  has one.
- `thrown-call`: a callee that can throw is called after this function
  already threw. The first error is lost if the callee throws too.
- `maybe-thrown-call` (hidden by default, `--kind maybe-thrown-call`): a
  callee that can throw is called after a helper that may have thrown into
  our scope and returned a failure value (`if (!readOption(...)) return;`
  style helpers, lambdas with `RETURN_IF_EXCEPTION` inside). The analysis
  cannot see the result test, so these need a human look.

## How a callee is classified

1. The lists in `nothrow.txt` win. Each line is `<qualified name> [kind]`.
   `indirect:<member>` classifies calls through a function-pointer member
   (method tables).
2. `exception`, `clearException`, `assertNoException*`, `tryClearException`,
   `hasExceptionsAfterHandlingTraps` on a scope or the VM are checks.
   `release` is a release. `throwException` and functions named `throw*`
   that take a global object or scope are throwers, as is `Bun::ERR::*`.
3. A body visible in the translation unit (inline, template, same file,
   lambda) is analyzed. A body that constructs a `ThrowScope` can throw. A
   body with no scope that calls something that can throw is
   "transparent": its callers see the exit states of its body. A body that
   checks everything before it returns leaves no pending bit, like the
   validator.
4. A body seen by the summary passes (JavaScriptCore sources, then Bun's
   sources) is classified from the recorded summary.
5. Otherwise the JSC convention applies: a parameter of type
   `JSGlobalObject*` (or a subclass) or `ThrowScope&` means it can throw.
   Calls through function pointers use the signature the same way.

Path sensitivity is limited to the exception state. A `toNumber()` guarded
by `isNumber()` is still reported because the slow path exists. Use
`asNumber()` after the type check instead. That is also what REVIEW.md asks
for.
