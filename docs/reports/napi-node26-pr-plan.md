# Bun N-API vs Node 26: Re-verified Findings & PR Plan

**Re-verified against:** `main@506945ef46` (2026-08-02)

**Change since original audit:** `napi_make_callback` `is_any_error()` check was already fixed by #35329. All other findings confirmed still present.

**Tally:** 7 P0, ~25 P1, ~20 P2, header gaps. 40/41 originally-flagged items still real.

---

## PR 1: Crash fixes + high-value one-liners

Small, surgical, immediately mergeable. Each fix is 1-5 lines.

| Fix | Location | Change |
|---|---|---|
| `NAPI_CHECK_ENV_NOT_IN_GC` derefs null env | napi.cpp macro | Add `NAPI_CHECK_ARG(_env, _env);` before `(_env)->checkGC()`. Fixes `napi_is_exception_pending`, `napi_typeof` null-env crashes. |
| `napi_call_function` derefs null env | napi.cpp:~3130 | Move `env->throwPendingException()` after `NAPI_PREAMBLE` (or null-check first) |
| `napi_is_error` derefs null result | napi_body.rs:~1302 | Use `get_out!(env, result)` instead of unchecked `*result` |
| `napi_async_init` derefs null result | napi_body.rs:~1128 | Add `get_out!(env, async_ctx)` |
| `error_messages[]` missing 2 entries | napi.cpp:~221 | Add `"External buffers are not allowed"`, `"Cannot run JavaScript"`; bump `last_status` to `napi_cannot_run_js`. Likely fixes #20663 |
| `napi_create_reference` wrong version gate | napi.cpp:~1103 | `== NAPI_VERSION_EXPERIMENTAL` → `>= 10` |
| Rust `NapiStatus` missing variants | napi_body.rs:~345 | Add `no_external_buffers_allowed = 22`, `cannot_run_js = 23` |

**Test:** add a native test module with `napi_typeof(NULL, ...)`, `napi_is_error(env, v, NULL)`, etc. checking for `napi_invalid_arg` instead of crash; `napi_create_reference` on a number at v10; `napi_get_last_error_info` after a `napi_cannot_run_js` return.

---

## PR 2: Re-sync public headers from Node 26

Mechanical. Copy `js_native_api.h`, `js_native_api_types.h`, `node_api.h`, `node_api_types.h` verbatim from `nodejs/node@v26.x`, then re-apply Bun's one intentional divergence (`typedef struct NapiEnv* napi_env;`).

Brings in:
- `node_api_basic_env` / `node_api_nogc_env` / `node_api_basic_finalize` / `node_api_nogc_finalize` / `node_api_noenv_finalize` typedefs
- `NAPI_CDECL`, `napi_cleanup_hook`, `node_api_addon_get_api_version_func`
- Modern `NAPI_MODULE_INIT()` that emits `node_api_module_get_api_version_v1`
- `NODE_API_EXPERIMENTAL_HAS_*` feature macros
- Correct version gates (`NAPI_VERSION >= 9` instead of `NAPI_EXPERIMENTAL`) for `node_api_symbol_for` / `node_api_create_syntax_error` / `node_api_throw_syntax_error` / `node_api_get_module_file_name`
- Declarations for `node_api_post_finalizer`, `node_api_create_buffer_from_arraybuffer`

**Test:** build the existing napi test addons against the new headers; compile-only test that `#include <node_api.h>` and uses `node_api_basic_env`.

---

## PR 3: PREAMBLE parity + argument validation

Add `checkGC()` + `can_call_into_js()` (returns `napi_cannot_run_js`/`napi_pending_exception` based on `nm_version`) to both `NAPI_PREAMBLE` (C++) and `preamble!` (Rust). Then fix the per-function validation gaps:

| Function | Fix |
|---|---|
| `napi_close_handle_scope` / `_escapable_` | null scope → `napi_invalid_arg`; track `open_handle_scopes` and return `napi_handle_scope_mismatch` instead of `RELEASE_ASSERT` |
| `napi_add_async_cleanup_hook` | allow duplicate `(hook,arg)` (key on handle ptr like Node); `hook==NULL` → `napi_invalid_arg` |
| `napi_open_callback_scope` / `_close_` | check env/result/scope; write `*result`; track scope count; clear last_error |
| `napi_escape_handle` | null-check escapee |
| `napi_add_env_cleanup_hook` / `_remove_` | `fun==NULL` → `napi_invalid_arg` |
| `napi_remove_async_cleanup_hook` | always free handle; don't touch env last_error |
| `napi_async_init` / `_destroy` / `napi_create_async_work` | add missing arg validation |
| `napi_create_threadsafe_function` | check `async_resource_name`, `initial_thread_count>0`, `func` type; return `napi_invalid_arg` not `napi_function_expected` |
| `napi_check_object_type_tag` | null-check result |
| `napi_wrap` | check `finalize_cb` when `result!=NULL` |
| `napi_get_cb_info` | `argv!=NULL && argc==NULL` → `napi_invalid_arg` |
| `napi_resolve_deferred` / `_reject_` | null-check resolution value |
| module load | clamp `module_api_version<8` to 8; error on `>10 && != EXPERIMENTAL` |

**Test:** extend `test/napi/napi-app` with null-arg / bad-type calls asserting specific status codes match Node.

---

## PR 4: Status-code alignment

Pure return-code changes (no crashes, but addon `status == X` checks break).

| Function | Wrong → Right |
|---|---|
| `napi_wrap`/`unwrap`/`remove_wrap`/`add_finalizer` non-object | `napi_object_expected` → `napi_invalid_arg` |
| `napi_coerce_to_number`/`_object`/`_string` on throw | `napi_pending_exception` → `napi_{number,object,string}_expected` |
| `napi_create_string_utf8` creation failure | `napi_pending_exception` → `napi_generic_failure` |
| `napi_create_typedarray`/`_dataview` non-AB | `napi_arraybuffer_expected` → `napi_invalid_arg` |
| `napi_create_typedarray` misaligned/oversize | generic RangeError → `ERR_NAPI_INVALID_TYPEDARRAY_{ALIGNMENT,LENGTH}` + `napi_generic_failure` |
| `napi_run_script` error | `napi_pending_exception` → `napi_generic_failure` |
| `napi_create_buffer*` alloc failure | `napi_pending_exception` → `napi_generic_failure` |
| `napi_create_bigint_words` INT_MAX<count≤UINT_MAX | throw + `napi_pending_exception` → `napi_invalid_arg` no throw |
| `napi_make_callback` non-function | `napi_function_expected` → `napi_invalid_arg`; add `recv`/`argv` checks |
| `napi_throw_error` (+3) | add pending-exception check (return `napi_pending_exception` instead of overwriting) |
| `node_api_post_finalizer` | remove `finalize_cb` null-check |
| `napi_ref/unref_threadsafe_function` | don't check env / don't touch last_error |

---

## PR 5: Semantic behavior fixes

These change observable runtime behavior beyond status codes.

| Function | Fix |
|---|---|
| `napi_set_property`/`_named_`/`_element` | check `putInline` return → `napi_generic_failure` on silent failure |
| `napi_set_named_property` | accept empty-string key |
| `napi_create_symbol` | `undefined`/`null` description → `napi_string_expected`; empty string → `.description === ""` |
| `napi_create_external_buffer` | `data==NULL \|\| len==0` → attached 0-length (don't detach) |
| `napi_reference_ref` | return 0 when referent already collected |
| `napi_define_properties`/`object_freeze`/`seal`/`type_tag_object`/`check_object_type_tag`/`node_api_set_prototype` | ToObject-coerce primitives; throw TypeError on null/undefined |
| `napi_get_typedarray_info` | reject non-TypedArray unconditionally |
| `napi_get_dataview_info` | reject non-DataView |
| `napi_get_buffer_info` | reject plain ArrayBuffer |
| `napi_get_prototype` | don't invoke Proxy trap; or at minimum check exception after |
| `napi_add_finalizer(result=NULL)` | track via NapiRef for env-teardown guarantee |
| `node_api_get_module_file_name` | set `env->filename` on `napi_module_register` path too; never NULL |
| `node_api_create_external_string_*` | `(NULL,0)` → ok; validate `len <= INT_MAX` |
| `napi_new_instance`/`get_named_property`/`has_named_property` | don't write `*result` on exception path |
| TSFN `call_js_cb` | pass `NULL` (not encoded undefined) when no func |
| TSFN abort | drain queue via `call_js_cb(NULL,NULL,ctx,data)`; run finalize_cb promptly |
| TSFN dispatch | add 1000-iteration cap |

---

## PR 6: Test vendoring

Sync from Node 26:
- `test/js-native-api/test_sharedarraybuffer`
- `test/node-api/test_threadsafe_function_abort`
- `test/node-api/test_threadsafe_function_shutdown`

---

## Open questions / intentionally-different (not in any PR)

- `napi_adjust_external_memory` returns per-env total (Node: isolate-wide). JSC has no isolate-wide counter; could sum across envs but probably not worth it.
- `napi_get_uv_event_loop` on POSIX returns a non-`uv_loop_t*`. Known limitation (#23192, #19727 area); out of scope here.
- `napi_fatal_error` stderr prefix differs. Cosmetic.
- Registered `Symbol.for` symbols pinned via `m_isEternal`. Deliberate JSC accommodation.

---

## Suggested order

PR 1 first (crashes, clear wins). PR 2 in parallel (mechanical, no runtime risk). PR 3+4 together or split. PR 5 needs the most review. PR 6 last, as acceptance tests for 3-5.
