# Public N-API headers

These four files are copied from `nodejs/node` `src/` and are what
`src/jsc/bindings/napi.cpp` compiles against and what `cc()` (bun:ffi)
bundles for `#include <node_api.h>` via `include_bytes!` in
`src/runtime/ffi/ffi_body.rs`.

To resync, copy the upstream files over and re-apply the divergences below
(all in `js_native_api_types.h`; the other three stay byte-identical). They
are excluded from clang-format in `scripts/run-clang-format.sh`.

Intentional divergences from upstream:

- `struct NapiEnv*` instead of `struct napi_env__*` (three `typedef` lines)
  so the opaque tag matches the concrete C++ type in
  `src/jsc/bindings/napi.h`.
- Default `NAPI_VERSION` is 10, not upstream's 8, so the v9/v10 APIs that
  Bun implements are declared without the includer opting in (#20772).
- The `NAPI_EXPERIMENTAL` `#warning`/`#pragma message` block is dropped:
  `cc()`'s TinyCC backend surfaces `#warning` through the error callback
  and fails the compile, and Bun's own C++ build (which defines
  `NAPI_EXPERIMENTAL`) is `-Werror`.
