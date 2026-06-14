# EXP-109 Root-Graph Correction — 2026-05-16

## Verdict

EXP-109 is **NO_EVIDENCE** for the stated Bun production-UB hypothesis.

The standalone Miri model remains a valid stale-handle shape, but it is not
source-faithful to Bun's current `new JSCallback(options, cb)` path because it
omits the native callback wrapper that owns JSC strong roots.

## Source Facts

1. `src/js/bun/ffi.ts:84-109`
   - `JSCallback` calls native `ffi.callback(options, cb)`.
   - It stores the returned native context in private field `#ctx`.
   - `close()` destroys that context via `closeCallback(ctx)`.

2. `src/runtime/ffi/ffi_body.rs:1322-1339`
   - `FFI::callback` heap-allocates a `Function`.
   - It returns `{ ptr, ctx }` to JS, where `ctx` is the heap `Function`.

3. `src/runtime/ffi/ffi_body.rs:2141`
   - `Function::compile_callback` calls
     `Bun__createFFICallbackFunction(js_context, js_function)`.

4. `src/runtime/ffi/ffi_body.rs:2263-2271`
   - The heap `Function` stores
     `ffi_callback_function_wrapper: NonNull::new(ffi_wrapper)`.
   - `Function::drop` destroys that wrapper.

5. `src/jsc/bindings/JSFFIFunction.cpp:47-70`
   - `FFICallbackFunctionWrapper` contains
     `JSC::Strong<JSC::JSFunction> m_function`.
   - It also contains `JSC::Strong<Zig::GlobalObject> globalObject`.

## Correction

The old EXP-109 text mixed two surfaces:

- FFI library symbol tables, whose `symbols` cache is represented by
  `JSFFI.symbolsValue`.
- User-created `JSCallback` callbacks, whose root is the C++
  `FFICallbackFunctionWrapper`, not the symbols table.

Because the wrapper owns `JSC::Strong` handles, a live `JSCallback.#ctx` keeps
the callback function and global object rooted. Running GC while `#ctx` is live
should not invalidate the callback.

The duplicate `src/runtime/ffi/mod.rs` `Compiled` scaffolding still contains a
bare `JSValue` comment, but the generated `callback` / `closeCallback` host path
uses `ffi_body::FFI`. Treat the duplicate as cleanup/hardening debt, not as a
live root-loss proof.

## Remaining Useful Work

- Add a regression test in the existing `test/js/bun/ffi/` area proving that a
  live `JSCallback` remains callable after forced GC.
- Delete or reconcile the duplicate `mod.rs` `Compiled` scaffolding during a
  future FFI cleanup so auditors do not inspect the wrong type.
- Keep `phase5_experiment_results/EXP-109.log` only as a generic stale-handle
  witness. Do not cite it as source-faithful Bun/JSC production evidence.
