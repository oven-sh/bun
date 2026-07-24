# Bun N-API vs Node.js 26: Comprehensive Comparison

**Method:** Symbol-level diff of exported functions, line-by-line comparison of all 161 `napi_*`/`node_api_*` implementations against `nodejs/node@v26.x` (`src/js_native_api_v8.cc`, `src/node_api.cc`), plus header/type diffs.

**Symbol coverage:** Bun exports all 161 symbols Node 26 declares. Zero missing at the link level.

**Node 26 `NODE_API_SUPPORTED_VERSION_MAX`:** 10. Bun's `napi_get_version` also returns 10.

---

## P0: Crashes on bad input (null deref, assert abort)

These crash the process where Node returns a status code:

| Function | Issue | Location |
|---|---|---|
| `napi_is_exception_pending` | null env → deref via `checkGC()` before null-check | [napi.cpp:1326](../src/jsc/bindings/napi.cpp#L1326) |
| `napi_typeof` | null env → deref via `checkGC()` (standalone `NAPI_CHECK_ENV_NOT_IN_GC` with no env-null check) | [napi.cpp:2726](../src/jsc/bindings/napi.cpp#L2726) |
| `napi_call_function` | null env → `env->throwPendingException()` before `NAPI_PREAMBLE`'s null-check | [napi.cpp:3153](../src/jsc/bindings/napi.cpp#L3153) |
| `napi_is_error` | null `result` → writes `*result` unconditionally | [napi_body.rs:1333](../src/runtime/napi/napi_body.rs#L1333) |
| `napi_async_init` | null `result` out-param → unchecked `*async_ctx = ...` | [napi_body.rs:1149](../src/runtime/napi/napi_body.rs#L1149) |
| `napi_close_handle_scope` / `_escapable_` | unbalanced close → `RELEASE_ASSERT` abort (Node: `napi_handle_scope_mismatch`) | [napi_handle_scope.cpp:125](../src/jsc/bindings/napi_handle_scope.cpp#L125) |
| `napi_add_async_cleanup_hook` | duplicate `(hook,arg)` → `NAPI_RELEASE_ASSERT` abort (Node allows duplicates via per-handle key) | [napi.h:354](../src/jsc/bindings/napi.h#L354) |

---

## P1: Wrong behavior that breaks real addons

| Function | Issue | Location |
|---|---|---|
| `napi_create_reference` | version gate is `== NAPI_VERSION_EXPERIMENTAL` instead of `>= 10` → v10 addons get `napi_invalid_arg` for primitive refs (Node allows since v10) | [napi.cpp:1126](../src/jsc/bindings/napi.cpp#L1126) |
| `napi_reference_ref` | after referent GC'd, returns incremented count instead of 0 (no `persistent_.IsEmpty()` short-circuit) | [NapiRef.cpp:9](../src/jsc/bindings/NapiRef.cpp#L9) |
| `napi_get_last_error_info` | missing 2 error strings (`no_external_buffers_allowed`, `cannot_run_js`) → `error_message=NULL` for codes Bun itself returns | [napi.cpp:218](../src/jsc/bindings/napi.cpp#L218) |
| `napi_throw_error` / `_type_error` / `_range_error` / `node_api_throw_syntax_error` | no pending-exception check → returns `napi_ok` and overwrites exception instead of `napi_pending_exception` | [napi.cpp:1104](../src/jsc/bindings/napi.cpp#L1104) |
| `napi_make_callback` | tests `res.is_any_error()` → callee *returning* (not throwing) an Error yields `napi_pending_exception` | [napi_body.rs:1209](../src/runtime/napi/napi_body.rs#L1209) |
| `napi_make_callback` | missing `recv`/`argv` null-checks, no `recv` ToObject, wrong status for non-function, no microtask drain | [napi_body.rs:1176](../src/runtime/napi/napi_body.rs#L1176) |
| `napi_open_callback_scope` | `*result` never written (garbage), no env/result null-check, `last_error` not cleared | [napi_body.rs:1281](../src/runtime/napi/napi_body.rs#L1281) |
| `napi_close_callback_scope` | no env/scope null-check, never returns `napi_callback_scope_mismatch`, `last_error` not cleared | [napi_body.rs:1292](../src/runtime/napi/napi_body.rs#L1292) |
| TSFN `call_js_cb` | when no `func` supplied, passes napi_value-encoded `undefined` (non-NULL) instead of `NULL` — breaks `if (js_callback != NULL)` | [napi_body.rs:2734](../src/runtime/napi/napi_body.rs#L2734) |
| TSFN abort | queued items dispatched normally with live env/js; Node drains via `call_js_cb(NULL,NULL,ctx,data)` | [napi_body.rs:2651](../src/runtime/napi/napi_body.rs#L2651) |
| TSFN abort | `thread_finalize_cb` deferred until `thread_count==0`; Node runs promptly after abort | [napi_body.rs:2662](../src/runtime/napi/napi_body.rs#L2662) |
| TSFN dispatch | no 1000-iteration cap → can starve event loop under producer flood | [napi_body.rs:2602](../src/runtime/napi/napi_body.rs#L2602) |
| `napi_get_uv_event_loop` | on POSIX returns `bun::EventLoop*` not `uv_loop_t*` — libuv calls on it misbehave | [napi_body.rs:2252](../src/runtime/napi/napi_body.rs#L2252) |
| `napi_get_prototype` | invokes Proxy `getPrototypeOf` trap (Node doesn't); returns `napi_ok` with VM exception pending if trap throws | [napi_body.rs:878](../src/runtime/napi/napi_body.rs#L878) |
| `napi_set_property` / `_named_property` / `_element` | discards `put()` return → `napi_ok` instead of `napi_generic_failure` on silent set failure (Proxy trap returns false, non-writable) | [napi.cpp:415](../src/jsc/bindings/napi.cpp#L415) |
| `napi_set_named_property` | empty-string `utf8name` → `napi_invalid_arg`; Node accepts key `""` | [napi.cpp:602](../src/jsc/bindings/napi.cpp#L602) |
| `napi_define_properties` / `napi_object_freeze` / `napi_object_seal` / `napi_type_tag_object` / `napi_check_object_type_tag` / `node_api_set_prototype` | no ToObject coercion → `napi_object_expected` for primitives (Node boxes and returns `napi_ok`); no pending TypeError for null/undefined | [napi.cpp:1006](../src/jsc/bindings/napi.cpp#L1006), etc |
| `napi_create_symbol` | JS `undefined`/`null` description → `napi_ok` (Node: `napi_string_expected`); empty-string description dropped → `.description === undefined` not `""` | [napi.cpp:3063](../src/jsc/bindings/napi.cpp#L3063) |
| `napi_run_script` | script error → `napi_pending_exception` (Node: `napi_generic_failure`) | [napi.cpp:2958](../src/jsc/bindings/napi.cpp#L2958) |
| `napi_create_typedarray` | misaligned/oversize → generic RangeError without `.code` + `napi_pending_exception` (Node: `ERR_NAPI_INVALID_TYPEDARRAY_*` + `napi_generic_failure`) | [napi.cpp:1997](../src/jsc/bindings/napi.cpp#L1997) |
| `napi_get_typedarray_info` | doesn't reject non-TypedArray when `type` out-param is NULL → `napi_ok` for DataView/ArrayBuffer | [napi_body.rs:1443](../src/runtime/napi/napi_body.rs#L1443) |
| `napi_get_dataview_info` | accepts any TypedArray/ArrayBuffer (not just DataView) → `napi_ok` (Node: `napi_invalid_arg`) | [napi_body.rs:1513](../src/runtime/napi/napi_body.rs#L1513) |
| `napi_get_buffer_info` | accepts plain `ArrayBuffer` → `napi_ok` (Node: `napi_invalid_arg`) | [napi_body.rs:2073](../src/runtime/napi/napi_body.rs#L2073) |
| `napi_create_external_buffer` | `data==NULL \|\| length==0` → creates **detached** buffer; Node → attached 0-length | [napi.cpp:2350](../src/jsc/bindings/napi.cpp#L2350) |
| `napi_resolve_deferred` / `napi_reject_deferred` | missing null-check on resolution value → passes empty JSValue to JSC (Node: `napi_invalid_arg`) | [napi_body.rs:1571](../src/runtime/napi/napi_body.rs#L1571) |
| `napi_add_finalizer` (`result==NULL` path) | uses raw `heap.addFinalizer`, not tracked for env teardown → finalizer may never fire at shutdown | [napi.cpp:1174](../src/jsc/bindings/napi.cpp#L1174) |
| `node_api_get_module_file_name` | may write `*result = NULL` on legacy `napi_module_register` path; Node always non-NULL (empty string) | [napi.h:515](../src/jsc/bindings/napi.h#L515) |
| `napi_adjust_external_memory` | returns per-env total; Node returns isolate-wide total | [napi.cpp:1313](../src/jsc/bindings/napi.cpp#L1313) |
| `napi_create_threadsafe_function` | missing `async_resource_name` null-check, `initial_thread_count>0` check; wrong status for bad `func`/`call_js_cb`; non-function `func` accepted when `call_js_cb` set | [napi_body.rs:3064](../src/runtime/napi/napi_body.rs#L3064) |
| module load | no `module_api_version` validation (Node clamps `<8` to 8, errors on `>10 && != EXPERIMENTAL`) | [BunProcess.cpp:728](../src/jsc/bindings/BunProcess.cpp#L728) |

---

## P2: Wrong status codes / missing validation (edge cases)

### Systemic (affects ~50 functions each)

- **`NAPI_PREAMBLE` / `preamble!` missing `checkGC()`.** Node's `NAPI_PREAMBLE` includes `CHECK_ENV_NOT_IN_GC`; Bun's does not. ~50 JS-touching functions skip the fatal-on-call-from-GC-finalizer assertion (only fires for `NAPI_VERSION_EXPERIMENTAL` modules). Full list in appendix A. Fix: add `checkGC()` to both preamble macros. [napi.cpp:89](../src/jsc/bindings/napi.cpp#L89), [napi_body.rs:428](../src/runtime/napi/napi_body.rs#L428)
- **`NAPI_PREAMBLE` / `preamble!` missing `can_call_into_js()`.** Node returns `napi_cannot_run_js` (v≥10) / `napi_pending_exception` (<10) when env is terminating. Bun has no equivalent except in `napi_throw`. Affects same ~50 functions. [napi.cpp:89](../src/jsc/bindings/napi.cpp#L89)

### Per-function status code / validation gaps

| Function(s) | Issue |
|---|---|
| `napi_wrap` / `napi_unwrap` / `napi_remove_wrap` / `napi_add_finalizer` | non-object → `napi_object_expected` (Node: `napi_invalid_arg`) |
| `napi_wrap` | missing `finalize_cb!=NULL` check when `result!=NULL` |
| `napi_check_object_type_tag` | missing `result!=NULL` check → silently `napi_ok` |
| `napi_coerce_to_number` / `_object` / `_string` | coercion throw → `napi_pending_exception` (Node: `napi_{number,object,string}_expected`) |
| `napi_create_bigint_words` | `INT_MAX < word_count <= UINT_MAX` → `napi_pending_exception` + RangeError (Node: `napi_invalid_arg` no throw) |
| `napi_create_string_utf8` / `node_api_create_property_key_utf8` | creation failure → `napi_pending_exception` (Node: `napi_generic_failure`, and Bun's own latin1/utf16 return `generic_failure`) |
| `node_api_create_external_string_latin1` / `_utf16` | extra pending-exception gate; `(NULL,0)` rejected; missing `length<=INT_MAX` check (silent truncation) |
| `node_api_symbol_for` / `napi_create_function` / `napi_define_class` | missing `length > INT_MAX` → `napi_invalid_arg` validation |
| `napi_create_typedarray` / `napi_create_dataview` | non-ArrayBuffer → `napi_arraybuffer_expected` (Node: `napi_invalid_arg`) |
| `napi_get_cb_info` | `argv!=NULL && argc==NULL` → `napi_ok` (Node: `napi_invalid_arg`) |
| `napi_escape_handle` | missing null-check on `escapee` |
| `napi_close_handle_scope` / `_escapable_` | null `scope` → `napi_ok` (Node: `napi_invalid_arg`) |
| `napi_create_buffer` / `_buffer_copy` / `_external_buffer` | alloc failure → `napi_pending_exception` (Node: `napi_generic_failure`) |
| `napi_add_env_cleanup_hook` / `_remove_` | `fun==NULL` → `napi_ok` (Node: `napi_invalid_arg`) |
| `napi_add_async_cleanup_hook` | `hook==NULL` → `napi_ok` with `*remove_handle` unwritten (Node: `napi_invalid_arg`) |
| `napi_remove_async_cleanup_hook` | handle not found → not freed (leak); touches env `last_error` (Node doesn't) |
| `napi_create_async_work` | missing `async_resource` object-check, `async_resource_name` null/string-check; wrong Rust param type `*const c_char` |
| `napi_async_init` | missing `async_resource_name` null/string-check, `async_resource` object-check |
| `napi_async_destroy` | missing `async_context` null-check |
| `node_api_post_finalizer` | extra `finalize_cb` null-check (Node accepts NULL) |
| `napi_ref_threadsafe_function` / `_unref_` | null env → `napi_invalid_arg` (Node: `napi_ok`); clears `last_error` (Node doesn't) |
| `node_api_create_buffer_from_arraybuffer` | accepts SharedArrayBuffer; wrong status for non-AB; out-of-range → `napi_pending_exception` (Node: `napi_ok`) |
| `napi_new_instance` / `napi_get_named_property` / `napi_has_named_property` | `*result` written on exception path (Node leaves untouched) |

---

## P3: Header-only issues (compile-time, not runtime)

These affect addons compiled **against Bun's headers** (most real addons ship prebuilt or compile against Node's headers, so runtime impact is limited):

- **Missing typedefs:** `node_api_basic_env`, `node_api_nogc_env`, `node_api_basic_finalize`, `node_api_nogc_finalize`, `napi_cleanup_hook`, `node_api_addon_get_api_version_func`, `NAPI_CDECL`
- **Stale `NAPI_MODULE_INIT()`:** Bun's macro uses deprecated `NAPI_C_CTOR` + `napi_module_register`. Node 26's emits `node_api_module_get_api_version_v1()` + `napi_register_module_v1()`. An addon built with Bun's header won't export the version symbol, so both Bun and Node fall back to api_version 8.
- **Missing declarations** (implementations exist): `node_api_post_finalizer`, `node_api_create_buffer_from_arraybuffer`
- **Missing feature-detection macros:** `NODE_API_EXPERIMENTAL_HAS_POST_FINALIZER`, `_HAS_CREATE_OBJECT_WITH_PROPERTIES`, `_HAS_SET_PROTOTYPE`, `_HAS_SHAREDARRAYBUFFER`, `_HAS_CREATE_EXTERNAL_SHAREDARRAYBUFFER`
- **Wrong version gates:** `node_api_symbol_for`, `node_api_create_syntax_error`, `node_api_throw_syntax_error`, `node_api_get_module_file_name` are gated on `#ifdef NAPI_EXPERIMENTAL` (should be `#if NAPI_VERSION >= 9`)
- **Default `NAPI_VERSION`** = 10 (Node: 8) and in wrong file (`js_native_api.h` instead of `js_native_api_types.h`)
- **Rust `NapiStatus` enum** missing `no_external_buffers_allowed=22`, `cannot_run_js=23`
- `napi_env` struct tag `NapiEnv` vs `napi_env__` (breaks forward-decls)
- Missing `NODE_API_NO_EXTERNAL_BUFFERS_ALLOWED` guard; `__wasm32__` vs `__wasm__`; missing `__EMSCRIPTEN__` branch

**Recommendation:** re-sync all four header files verbatim from Node 26 (with only the `struct NapiEnv*` typedef swap).

---

## P4: Minor / intentional / cosmetic

- `napi_fatal_error`: lenient null handling, `"NAPI FATAL ERROR:"` prefix (Node: `"FATAL ERROR:"`)
- `napi_call_function`: pending exception moved to VM slot (Node leaves stashed)
- `napi_is_exception_pending`: also inspects VM slot (JSC accommodation)
- `napi_remove_wrap`: runtime-owned ref freed on GC instead of immediately
- `napi_create_reference`: registered `Symbol.for` symbols pinned via `m_isEternal` (Node: weak-collectable)
- `napi_create_buffer*`: `length==0` → `*data = nullptr` (Node may be non-null sentinel)
- TSFN: condvar `broadcast` on abort vs Node `Signal` (Bun arguably safer); finalizer deferred one extra event-loop turn on normal shutdown
- `napi_get_value_string_utf8`: lone-surrogate/truncation encoding may differ from V8 `kReplaceInvalidUtf8` (needs conformance test)
- GC-check vs pending-exception ordering swapped in PREAMBLE functions (only observable in pathological EXPERIMENTAL-finalizer-with-pending-exception case)
- Many arg-check order swaps where both paths return `napi_invalid_arg` (not observable)

---

## Functions verified OK

`napi_get_undefined`, `napi_get_null`, `napi_get_boolean`, `napi_create_int32/uint32/int64`, `napi_create_array[_with_length]`, `napi_get_value_double/int32/uint32/int64/bool/external`, `napi_get_value_string_latin1/utf16`, `napi_get_value_bigint_int64/uint64/words`, `napi_is_date/array/promise/arraybuffer/detached_arraybuffer/buffer`, `napi_strict_equals`, `napi_coerce_to_bool`, `napi_instanceof`, `napi_get_property_names`, `napi_get_all_property_names`, `napi_get_property`, `napi_has_property`, `napi_delete_property`, `napi_has_own_property`, `napi_get_element`, `napi_has_element`, `napi_delete_element`, `napi_create_arraybuffer`, `napi_get_arraybuffer_info`, `napi_detach_arraybuffer`, `node_api_is_sharedarraybuffer`, `napi_delete_reference`, `napi_reference_unref`, `napi_get_reference_value`, `napi_get_version`, `napi_get_instance_data`, `napi_set_instance_data`, `napi_queue_async_work`, `napi_cancel_async_work`, `napi_get_threadsafe_function_context`, `napi_acquire/release_threadsafe_function`, `napi_get_node_version`, `napi_get_and_clear_last_exception`, `napi_create_error/type_error/range_error`, `node_api_create_syntax_error`, `napi_create_external`, `napi_delete_async_work`, `napi_get_new_target`, `node_api_create_sharedarraybuffer`, `node_api_create_external_sharedarraybuffer`.

---

## Test coverage gaps

Node 26 test directories **not** vendored into `test/napi/node-napi-tests/`:
- `test/js-native-api/test_sharedarraybuffer`
- `test/node-api/test_threadsafe_function_abort`
- `test/node-api/test_threadsafe_function_shutdown`

Existing vendored tests marked `test.todo` (known failures):
- `test_async` (test.js, test-uncaught.js, test-async-hooks.js)
- `test_async_cleanup_hook` (test.js)
- `test_async_context` (test.js, test-gcable.js, test-gcable-callback.js)
- `test_buffer` (test.js)
- `test_callback_scope` (test-resolve-async.js, test-async-hooks.js)
- `test_fatal` (test.js, test2.js, test_threads.js)
- `test_instance_data` (test.js)
- `test_make_callback` (test-async-hooks.js)
- `test_make_callback_recurse` (test.js)
- `test_threadsafe_function` (test.js, test_legacy_uncaught_exception.js)
- `test_uv_loop` (test.js)
- `test_uv_threadpool_size` (test.js, node-options.js)
- `test_worker_buffer_callback` (test.js, test-free-called.js)
- `test_worker_terminate` (test.js)

---

## Appendix A: Functions missing the GC check (via PREAMBLE gap)

**C++ (`napi.cpp`, `NAPI_PREAMBLE` without `NAPI_CHECK_ENV_NOT_IN_GC`):**
`napi_set_property`, `napi_has_property`, `napi_get_property`, `napi_delete_property`, `napi_has_own_property`, `napi_set_named_property`, `napi_has_named_property`, `napi_get_named_property`, `napi_set_element`, `napi_has_element`, `napi_get_element`, `napi_delete_element`, `napi_get_date_value`, `napi_wrap`, `napi_unwrap`, `napi_remove_wrap`, `napi_create_function`, `napi_define_properties`, `napi_define_class`, `napi_get_all_property_names`, `napi_get_property_names`, `napi_object_freeze`, `napi_object_seal`, `napi_create_dataview`, `napi_create_typedarray`, `napi_coerce_to_string/bool/number/object`, `napi_create_buffer`, `napi_create_external_buffer`, `napi_create_external_arraybuffer`, `napi_create_external`, `napi_run_script`, `napi_create_bigint_words/int64/uint64`, `napi_new_instance`, `napi_instanceof`, `napi_call_function`, `napi_type_tag_object`, `napi_check_object_type_tag`, `napi_fatal_exception`, `napi_throw_error/type_error/range_error`, `node_api_throw_syntax_error`, `node_api_create_buffer_from_arraybuffer`, `node_api_create_external_string_latin1/utf16`, `napi_is_buffer`, `napi_is_typedarray`

**Rust (`napi_body.rs`, `preamble!`/`get_env!` without `check_gc()`):**
`napi_get_prototype`, `napi_get_array_length`, `napi_strict_equals`, `napi_make_callback`, `napi_create_promise`, `napi_resolve_deferred`, `napi_reject_deferred`, `napi_create_date`, `napi_create_buffer_copy`, `napi_get_buffer_info`, `napi_is_dataview`, `napi_create_string_latin1/utf8/utf16`, `napi_async_init`, `napi_async_destroy`, `napi_create_async_work`, `napi_delete_async_work`, `napi_create_threadsafe_function`
