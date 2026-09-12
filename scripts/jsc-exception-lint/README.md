# jsc-exception-lint

A static checker for JavaScriptCore exception discipline in Bun's C++ code.
It finds the same class of bug that `BUN_JSC_validateExceptionChecks=1`
finds at run time, without needing a test to execute the path.

## In the build

The checker is a clang plugin. `bun bd` loads it into every compile of
bun's own C++ (`scripts/build/exception-lint.ts`), so a missing exception
check is a compile error:

```text
src/jsc/bindings/BunObject.cpp:412:16: error: jsc-exception-lint: call to
JSC::JSValue::toString while an exception check is pending after
JSC::JSValue::toString (BunObject.cpp:411); add RETURN_IF_EXCEPTION after it
src/jsc/bindings/BunObject.cpp:412:16: note: in Bun::functionFoo; baseline
entry: src/jsc/bindings/BunObject.cpp | Bun::functionFoo(JSC::JSGlobalObject *,
JSC::CallFrame *) | pending-call | JSC::JSValue::toString
```

The plugin runs on the AST the compile already has. Loading it and reading
its data files costs about 40 ms per compiler process, the analysis a few
tens of milliseconds per translation unit (300 ms for `bindings.cpp`, the
largest). Building the plugin itself is one extra edge of 10 to 20 seconds
that runs in parallel with the PCH.

It is on in assertion builds (debug, asan: every `bun bd` and the CI asan
lane) when the target is not Windows and clang's development headers are
installed next to the compiler (`include/clang/Frontend/FrontendPluginRegistry.h`
and `lib/libclang-cpp.*`; apt: `libclang-21-dev` and `libclang-cpp21-dev`,
both part of `llvm.sh 21 all`; brew: part of `llvm`). Turn it off with
`bun bd --exceptionLint=off`. `--exceptionLint=on` fails configure with the
reason when the headers are missing or assertions are off.

Assertion builds only, because the check models the validator, which exists
under `ASSERT_ENABLED`. There `ThrowScope` has a destructor that asserts on
an unchecked exception, and the analysis reports at that destructor. In a
plain release build the destructor is trivial and is not in the CFG, so a
function that returns with a check pending cannot be reported, and the
result would depend on the build type. `RETURN_IF_EXCEPTION` and
`EXCEPTION_ASSERT` are still understood in a release build: the tool treats
their expansions as a check whether or not the assertion is compiled in.

Three kinds of input, all under this directory and all implicit inputs of
every C++ compile (a change recompiles everything, through ccache too):

- `nothrow.txt`: hand-written classifications, see below.
- `summaries/webkit.tsv`, `summaries/bun.tsv`: how each JavaScriptCore and
  Bun function treats the exception state, computed by `run.ts` (see
  "Summaries"). Only the rows that differ from the signature convention
  are kept.
- `baseline.tsv`: findings that are known and tolerated while they are
  being fixed. One per line: `<file>\t<function>\t<kind>\t<callee>`. The
  file is relative to the repo root. The function has its parameter types
  and, for a member function, its qualifiers (`const`, `&&`), so overloads
  have their own entries. Names have no template arguments, so one entry
  covers every instantiation. A lambda is `<lambda at file>`, and a call
  through a function pointer member is `<indirect call through member>`.
  There are no line numbers, so an edit elsewhere in the file does not
  change a key. The error note prints the key. An entry for a `.cpp` file
  that no longer fires is a warning that names it, so the list only
  shrinks. Fix the finding instead of adding to this file. If the finding
  is a false positive, add the callee to `nothrow.txt`.

A finding in a header is reported by every compile that produces it, like
a compiler warning in a header. Compiles see different template
instantiations, so no single one sees them all. For the same reason an
entry for a header is not reported when it stops firing.

## Run by hand

```sh
bun scripts/jsc-exception-lint/run.ts                 # whole tree
bun scripts/jsc-exception-lint/run.ts src/jsc/bindings/BunObject.cpp
bun scripts/jsc-exception-lint/run.ts --kind pending-call,thrown-call
bun scripts/jsc-exception-lint/rust-externs.ts        # Rust externs vs C++ summaries
```

The same source, built as a standalone LibTooling program. It needs a
configured debug build (`build/debug/compile_commands.json` and the
generated headers) and the LLVM 21 development package. Set `LLVM_DIR` if it
is not under `/usr/lib/llvm-21`.

## Summaries

Functions defined in another translation unit cannot be analyzed from their
call site. Export passes record each function's effect on the exception
state, and the result is committed under `summaries/` so that plain runs and
the compiler plugin need no extra passes.

```sh
bun scripts/jsc-exception-lint/run.ts --update-summaries           # Bun's sources
bun scripts/jsc-exception-lint/run.ts --update-summaries --webkit  # and JavaScriptCore
```

Run the first after a change to how a helper in `src/` handles exceptions
(a new `RETURN_IF_EXCEPTION` in a helper other files call, a helper that
gains or loses a `ThrowScope`). The plugin and the standalone tool also
analyze every body visible in the translation unit, so the committed file
only matters for calls across files. Run the second after a WebKit bump. It
parses the JavaScriptCore sources three times, about 35 minutes on 14
cores, cached in `build/debug/jsc-exception-lint/` per WebKit version.
`webkit.tsv` records the version in its first line, so a stale file is
visible in review.

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
- `maybe-thrown-call` (hidden by default, `--kind maybe-thrown-call`, not
  reported by the plugin): a callee that can throw is called after a helper
  that may have thrown into our scope and returned a failure value
  (`if (!readOption(...)) return;` style helpers, lambdas with
  `RETURN_IF_EXCEPTION` inside). The analysis cannot see the result test,
  so these need a human look.

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
   Calls through function pointers use the signature the same way. Two
   refinements: the cell boilerplate (`create`, `createStructure`,
   `finishCreation`, `createPrototype`, `getConstructor`, `prototype`,
   `getDOMStructure` and friends) with a `VM&` first parameter cannot
   throw, and an `extern "C"` function with no C++ body is implemented in
   Rust; it runs under its own scope and signals a throw through its
   return value, so it is a conditional thrower.

The committed summaries hold only the functions for which the convention
(rule 5) is wrong: a function that takes a global object but cannot throw,
a function with no scope of its own that passes the state through, or the
reverse. That is why they are long: the convention is wrong for most
helpers that take a global object only to reach the VM or a structure.
On the current tree the build reports about 90 findings with them and
about 950 without.

Path sensitivity is limited to the exception state. A `toNumber()` guarded
by `isNumber()` is still reported because the slow path exists. Use
`asNumber()` after the type check instead. That is also what REVIEW.md asks
for.

Generated C++ under `build/*/codegen` is summarized (calls into it are
classified from its bodies) but not analyzed: the generators own that code.
