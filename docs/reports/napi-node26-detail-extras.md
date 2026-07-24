# Type Definition & Enum Comparison: Bun vs Node.js 26 N-API

## File 1: `js_native_api_types.h`
Bun: `/workspace/bun/src/runtime/napi/js_native_api_types.h`
Node 26: `/tmp/node26_js_native_api_types.h`

### Missing macros / version defines
- **`NAPI_VERSION_EXPERIMENTAL` / default `NAPI_VERSION`**: Node 26 defines these in `js_native_api_types.h` (lines 5–17, default `NAPI_VERSION` = **8**). Bun defines them in `js_native_api.h` instead (lines 8–22, default `NAPI_VERSION` = **10**). The *location* difference means an addon that includes only `js_native_api_types.h` gets no `NAPI_VERSION` from Bun. The *value* difference (10 vs 8) changes which version-gated declarations are visible by default.
- **`NAPI_CDECL`** (Node lines 41–47): Missing entirely from Bun. Node uses it on every callback typedef (`napi_callback`, `napi_finalize`, etc.). Cosmetic on POSIX; on Windows it forces `__cdecl`.
- Bun is missing the Node-26 `#pragma message / #warning` block for `NAPI_EXPERIMENTAL` (Node lines 19–29). Cosmetic only.

### Missing typedefs
- **`node_api_nogc_env`** (Node line 77/79): Missing in Bun.
- **`node_api_basic_env`** (Node line 81): Missing in Bun. This is the "safe-in-GC" env type used by many Node-26 prototypes (`napi_get_version`, `napi_delete_reference`, `napi_set_instance_data`, etc.).
- **`node_api_nogc_finalize`** (Node line 183/185): Missing in Bun.
- **`node_api_basic_finalize`** (Node line 189): Missing in Bun. Used in Node 26 prototypes for `napi_wrap`, `napi_add_finalizer`, `napi_create_external`, `napi_create_external_arraybuffer`, `napi_create_external_buffer`, `node_api_create_external_string_*`.
- **`node_api_noenv_finalize`** (Node line 192): Not in Bun's `js_native_api_types.h`. Bun defines it ad-hoc inside `js_native_api.h` (line 499, gated under `NAPI_EXPERIMENTAL`) and re-typedefs it again in `napi.cpp:1727`. Node 26 defines it unconditionally in the types header.

### `napi_env` underlying struct name
- Bun line 16: `typedef struct NapiEnv* napi_env;`
- Node line 51: `typedef struct napi_env__* napi_env;`
- Both are opaque. Only observable to code that forward-declares `struct napi_env__` — that forward-decl wouldn't match Bun's `NapiEnv`.

### Enums — all match
- `napi_property_attributes`: **OK** (identical values).
- `napi_valuetype`: **OK** (identical ordering, 0–9).
- `napi_typedarray_type`: **OK** (identical ordering incl. `napi_float16_array` = 11 and the `NODE_API_HAS_FLOAT16_ARRAY` guard macro).
- `napi_status`: **OK** (identical 0–23, through `napi_cannot_run_js`).
- `napi_key_collection_mode`, `napi_key_filter`, `napi_key_conversion`: **OK**.

### Structs — all match
- `napi_property_descriptor`, `napi_extended_error_info`, `napi_type_tag`: **OK** (identical layouts).

---

## File 2: `node_api_types.h`
Bun: `/workspace/bun/src/runtime/napi/node_api_types.h`
Node 26: `/tmp/node26_node_api_types.h`

### Missing typedefs
- **`napi_addon_register_func`** (Node line 6): Not in Bun's `node_api_types.h`; Bun defines it in `node_api.h:31` instead. Location-only difference.
- **`node_api_addon_get_api_version_func`** (Node line 10): Missing entirely from Bun's headers.
- **`napi_cleanup_hook`** (Node line 17, gated `NAPI_VERSION >= 3`): Missing from Bun. Bun's `napi_add_env_cleanup_hook` / `napi_remove_env_cleanup_hook` prototypes use a raw `void (*fun)(void* arg)` inline type instead (node_api.h:177,181).

### Enums — all match
- `napi_threadsafe_function_release_mode`: **OK**.
- `napi_threadsafe_function_call_mode`: **OK**.

### Structs / opaque types — all match
- `napi_callback_scope`, `napi_async_context`, `napi_async_work`, `napi_threadsafe_function`, `napi_node_version`, `napi_async_cleanup_hook_handle`, `napi_async_cleanup_hook`: **OK**.

### Callback typedefs
- `napi_async_execute_callback`, `napi_async_complete_callback`, `napi_threadsafe_function_call_js`: **OK** (same signatures; Bun lacks `NAPI_CDECL` wrapper only).

---

## Rust-side enum (`/workspace/bun/src/runtime/napi/napi_body.rs`)

### `NapiStatus` (lines 343–368)
- **Missing `no_external_buffers_allowed = 22`** and **missing `cannot_run_js = 23`**. The Rust enum stops at `would_deadlock = 21`. The C header has them and `napi.cpp:1390` returns `napi_cannot_run_js`, but Rust-implemented functions cannot return these two codes via the enum.

### `napi_typedarray_type` (lines 304–319)
- **OK** — matches Node 26 including `float16_array = 11`.

### Struct layouts (lines 381–409)
- `napi_property_descriptor`, `napi_extended_error_info`, `napi_type_tag`: **OK**.

---

## Related header differences (`js_native_api.h` / `node_api.h`) worth flagging

These aren't in the two "types" files but affect compile-time API surface an addon sees:

### `js_native_api.h`
- Bun is **missing declaration** for `node_api_post_finalizer` (Node line 552, `NAPI_EXPERIMENTAL`). Bun implements it in `napi.cpp:1183` but doesn't declare it in the public header.
- Bun is **missing the feature-detection macros** Node 26 defines under `NAPI_EXPERIMENTAL`: `NODE_API_EXPERIMENTAL_HAS_CREATE_OBJECT_WITH_PROPERTIES`, `NODE_API_EXPERIMENTAL_HAS_SET_PROTOTYPE`, `NODE_API_EXPERIMENTAL_HAS_CREATE_EXTERNAL_SHAREDARRAYBUFFER`, `NODE_API_EXPERIMENTAL_HAS_SHAREDARRAYBUFFER`, `NODE_API_EXPERIMENTAL_HAS_POST_FINALIZER`.
- Bun gates `node_api_symbol_for`, `node_api_create_syntax_error`, `node_api_throw_syntax_error` under `#ifdef NAPI_EXPERIMENTAL` (lines 88, 104, 302); Node 26 gates them under `#if NAPI_VERSION >= 9`.
- Bun uses `#elif defined(__wasm32__)` (line 31); Node 26 uses `__wasm__`.
- Finalizer-callback parameter types: Node 26 declares `napi_wrap`, `napi_create_external`, `napi_create_external_arraybuffer`, `napi_add_finalizer`, `node_api_create_external_string_{latin1,utf16}` with `node_api_basic_finalize`; Bun declares them with `napi_finalize`. Same runtime ABI, but loses the compile-time "not-in-GC" typing Node 26 introduced.
- Env parameter types: Node 26 declares `napi_get_last_error_info`, `napi_get_version`, `napi_adjust_external_memory`, `napi_delete_reference`, `napi_set_instance_data`, `napi_get_instance_data` with `node_api_basic_env`; Bun uses plain `napi_env`.

### `node_api.h`
- Bun is **missing declaration** for `node_api_create_buffer_from_arraybuffer` (Node line 134, `NAPI_VERSION >= 10`). Bun implements it in `napi.cpp:1573` but doesn't declare it in the public header.
- Bun is **missing** `NODE_API_MODULE_GET_API_VERSION_BASE` / `NODE_API_MODULE_GET_API_VERSION` macros (Node lines 59–66) and the modern `NAPI_MODULE_INIT()` definition that emits `node_api_module_get_api_version_v1()` (Node lines 68–76). Bun still uses the deprecated `NAPI_C_CTOR` / `napi_module_register` path for `NAPI_MODULE` / `NAPI_MODULE_INIT()`. An addon built against Bun's header won't emit `node_api_module_get_api_version_v1`, so the host (Bun or Node) falls back to `NODE_API_DEFAULT_MODULE_API_VERSION` (8) for that addon.
- Bun gates `node_api_get_module_file_name` under `NAPI_EXPERIMENTAL` (line 239); Node 26 gates it under `NAPI_VERSION >= 9`.
- Node 26 wraps threadsafe-function decls without `#ifndef __wasm32__`; Bun still has `#ifndef __wasm32__` (line 196).
- Env parameter types: Node 26 declares `napi_queue_async_work`, `napi_cancel_async_work`, `napi_get_node_version`, `napi_get_uv_event_loop`, `napi_add_env_cleanup_hook`, `napi_remove_env_cleanup_hook`, `napi_unref_threadsafe_function`, `napi_ref_threadsafe_function`, `napi_add_async_cleanup_hook`, `node_api_get_module_file_name` with `node_api_basic_env`; Bun uses plain `napi_env`.
- `napi_create_external_buffer`: Node 26 uses `node_api_basic_finalize`; Bun uses `napi_finalize`. Node 26 also wraps it in `#ifndef NODE_API_NO_EXTERNAL_BUFFERS_ALLOWED`; Bun does not.
- Bun is missing the `__EMSCRIPTEN__` branch for `NAPI_MODULE_EXPORT` (Node lines 20–22).

---

## Summary table of missing type-level items

| Item | Kind | Node 26 location | Bun status |
|---|---|---|---|
| `node_api_basic_env` | typedef | js_native_api_types.h:81 | **Missing** |
| `node_api_nogc_env` | typedef | js_native_api_types.h:77 | **Missing** |
| `node_api_basic_finalize` | typedef | js_native_api_types.h:189 | **Missing** |
| `node_api_nogc_finalize` | typedef | js_native_api_types.h:183 | **Missing** |
| `node_api_noenv_finalize` | typedef | js_native_api_types.h:192 | In wrong file (`js_native_api.h:499`), gated under `NAPI_EXPERIMENTAL` |
| `NAPI_CDECL` | macro | js_native_api_types.h:41 | **Missing** |
| `napi_cleanup_hook` | typedef | node_api_types.h:17 | **Missing** |
| `node_api_addon_get_api_version_func` | typedef | node_api_types.h:10 | **Missing** |
| `napi_addon_register_func` | typedef | node_api_types.h:6 | In `node_api.h` instead |
| `NapiStatus::no_external_buffers_allowed` (Rust) | enum variant | — | **Missing** (napi_body.rs:345) |
| `NapiStatus::cannot_run_js` (Rust) | enum variant | — | **Missing** (napi_body.rs:345) |
| `NODE_API_MODULE_GET_API_VERSION*` | macros | node_api.h:59–66 | **Missing** |
| `NODE_API_EXPERIMENTAL_HAS_*` feature macros | macros | js_native_api.h | **Missing** |
| `node_api_post_finalizer` decl | prototype | js_native_api.h:552 | **Missing** (impl exists in napi.cpp:1183) |
| `node_api_create_buffer_from_arraybuffer` decl | prototype | node_api.h:134 | **Missing** (impl exists in napi.cpp:1573) |

All enum **orderings and values** match; all **struct layouts** match.

---

# ERROR INFO / STATUS TABLE comparison

## `error_messages[]` array

**Node 26** (`/tmp/node26_js_native_api_v8.cc:889-914`): 24 entries, `last_status = napi_cannot_run_js`.
**Bun** (`/workspace/bun/src/jsc/bindings/napi.cpp:218-243`): 22 entries, `last_status = napi_would_deadlock`.

- **Bun is missing the last two entries.** Node has, after `"Main thread would deadlock"`:
  - `"External buffers are not allowed"` → `napi_no_external_buffers_allowed` (22)
  - `"Cannot run JavaScript"` → `napi_cannot_run_js` (23)

  Bun's own `napi_status` C enum **does** define both values (`/workspace/bun/src/runtime/napi/js_native_api_types.h:96-97`), and Bun actually **returns** `napi_cannot_run_js` at `/workspace/bun/src/jsc/bindings/napi.cpp:1390`. So an addon that receives `napi_cannot_run_js` and then calls `napi_get_last_error_info` will see `error_message == NULL` in Bun vs `"Cannot run JavaScript"` in Node. This is an observable behavioral difference.

- The 22 strings that Bun does have (indices 0–21) are **byte-identical** to Node's.

- **Rust enum is also stale.** `NapiStatus` at `/workspace/bun/src/runtime/napi/napi_body.rs:345-368` stops at `would_deadlock = 21`; it is missing `no_external_buffers_allowed = 22` and `cannot_run_js = 23`. (Not directly user-observable since Rust-side code never returns those, but it's out of sync with the C header.)

## `napi_get_last_error_info`

Node: `/tmp/node26_js_native_api_v8.cc:916-940` — Bun: `/workspace/bun/src/jsc/bindings/napi.cpp:208-259`.

- **Missing messages for valid codes** — because `last_status` is `napi_would_deadlock` (napi.cpp:218), the range guard at napi.cpp:249 (`status >= 0 && status <= last_status`) falls through to the `else` branch for `napi_no_external_buffers_allowed`/`napi_cannot_run_js`, so `error_message` is set to `nullptr` (napi.cpp:252). Node returns the correct message string. **Observable.**

- **Out-of-range handling differs** — Node does `CHECK_LE(env->last_error.error_code, last_status)` (line 930), a hard `CHECK` that aborts the process if the code is out of range. Bun silently returns `error_message = nullptr`. Only observable with an invalid status code (or, currently, with the two valid codes Bun wrongly treats as out of range).

- **Node clears on `napi_ok`, Bun does not** — Node (lines 935-937): when `error_code == napi_ok`, calls `napi_clear_last_error(env)` before writing `*result`, which zeroes `engine_error_code`, `engine_reserved`, and `error_message`. Bun (napi.cpp:248-255) skips this clear and only writes `error_message`. In practice **not observable** in Bun because `engine_error_code`/`engine_reserved` are initialized to 0/`nullptr` (`/workspace/bun/src/jsc/bindings/napi.h:504-511`) and Bun's `napi_set_last_error` (napi.cpp:186-193) never touches them, so they stay zero forever. (Node's `napi_set_last_error` resets those two fields on every call via default args, js_native_api_v8.h:180-189; Bun's only sets `error_code`. Same non-observable caveat.)

- **Arg validation / return semantics** — OK. Both: null-env → `napi_invalid_arg` (no last-error write); null-result → `napi_invalid_arg` via `CHECK_ARG`/`NAPI_CHECK_ARG` (sets last-error); neither does a not-in-GC check (Node uses plain `CHECK_ENV`, not `CHECK_ENV_NOT_IN_GC`); both return raw `napi_ok` without overwriting the stored error info.

## Files

- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 186-259)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 504-511)
- `/workspace/bun/src/runtime/napi/js_native_api_types.h` (lines 73-98)
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 345-368)
- `/tmp/node26_js_native_api_v8.cc` (lines 889-940)
- `/tmp/node26_js_native_api_v8.h` (lines 171-189)

---

# N-API Reference Semantics: Bun vs Node.js 26

## `napi_create_reference`
- **Version gate for non-object/function/symbol values is wrong.** Bun [napi.cpp:1125-1127] rejects primitives unless `nm_version == NAPI_VERSION_EXPERIMENTAL`. Node [js_native_api_v8.cc:2829-2834] rejects them only when `module_api_version < 10`. Because `NAPI_VERSION_EXPERIMENTAL == 2147483647`, a module built against stable NAPI 10 (Bun's own `DEFAULT_NAPI_VERSION`) gets `napi_invalid_arg` from Bun but `napi_ok` from Node when creating a reference to a string/number/boolean/bigint/etc. This is a real compat bug.
- **`can_be_weak` predicate slightly differs.** Node's `CanBeHeldWeakly` is `IsObject() || IsSymbol()` [js_native_api_v8.cc:596-598]. Bun uses `val.isObject() || val.isCallable() || val.isSymbol()` (redundant `isCallable`, but a JS **string** is also `!can_be_weak` in Node yet Bun never reaches the `can_be_weak=false` branch for strings because the version gate rejects them first). Once the version gate is fixed, Bun will treat strings as `can_be_weak=false` (correct) but **symbols** registered via `Symbol.for` are weak-holdable in Node whereas Bun pins them permanently via `m_isEternal` [napi.h:826-836] — a deliberate divergence, but observable: in Node a weak reference to a registered symbol reads back `nullptr` after collection; in Bun it reads back the symbol forever.

## `napi_reference_ref`
- **After the referent has been GC'd, Node returns 0; Bun returns an incremented count.** Node's `Reference::Ref()` [js_native_api_v8.cc:690-700] short-circuits with `return 0` when `persistent_.IsEmpty()`. Bun's `NapiRef::ref()` [NapiRef.cpp:9-23] always does `++refCount` and then `strongRef.set(vm, weakValueRef.get())` even though the weak slot is cleared (the tag is still `Cell` so `isClear()` is `false`, but `.get()` is null). Result: `*result` is written with the new non-zero count in Bun, `0` in Node.

## `napi_reference_unref`
- OK for the user-facing precondition (both return `napi_generic_failure` when refcount is already 0 [napi.cpp:1203-1205] vs [js_native_api_v8.cc:2896-2898]).
- Internal `Unref()` difference mirrors the `Ref()` one above: Node short-circuits to 0 when `persistent_.IsEmpty()` [js_native_api_v8.cc:702-711]; Bun [NapiRef.cpp:25-34] decrements regardless. Observable only after the 0→1 `ref()` divergence above.

## `napi_get_reference_value`
OK.

## `napi_delete_reference`
OK. Both use basic-env semantics (no GC check, no pending-exception check).

## `napi_wrap`
- **Wrong status for non-object `js_object`.** Node [js_native_api_v8.cc:537] returns `napi_invalid_arg`; Bun [napi.cpp:857] returns `napi_object_expected`.
- **Missing `finalize_cb != NULL` check when `result != NULL`.** Node [js_native_api_v8.cc:547-552] does `CHECK_ARG(env, finalize_cb)` in that branch and returns `napi_invalid_arg` if null. Bun [napi.cpp:883-888] happily creates a ref with an empty finalizer and writes it to `*result`.
- **Missing "not in GC" check.** Node's `NAPI_PREAMBLE` expands to `CHECK_ENV_NOT_IN_GC`. Bun's `NAPI_PREAMBLE` [napi.cpp:89-95] does not call `checkGC()`, so an experimental-version module calling `napi_wrap` from a GC finalizer aborts in Node but proceeds in Bun.
- **Missing `can_call_into_js` / `napi_cannot_run_js` check.** Node's `NAPI_PREAMBLE` [js_native_api_v8.h:237-241] returns `napi_cannot_run_js` (or `napi_pending_exception` for <10) when the environment is terminating; Bun's preamble never produces `napi_cannot_run_js`.

## `napi_unwrap`
- **Wrong status for non-object.** Node [js_native_api_v8.cc:352] returns `napi_invalid_arg`; Bun [napi.cpp:938] returns `napi_object_expected`.
- Missing "not in GC" and `can_call_into_js` checks (same as `napi_wrap`).

## `napi_remove_wrap`
- **Wrong status for non-object.** Node returns `napi_invalid_arg`; Bun [napi.cpp:901] returns `napi_object_expected`.
- **Runtime-owned wrap reference is not freed immediately.** Node [js_native_api_v8.cc:368-373] does `delete reference` when ownership is `kRuntime` (the `result == nullptr` wrap path). Bun [napi.cpp:921-925] only clears the finalizer and lets the `NapiRefSelfDeletingWeakHandleOwner` free it on GC; the `boundCleanup` slot is also left registered until `~NapiRef`. Not observable via status codes, but a lifetime/ordering divergence.
- Missing "not in GC" / `can_call_into_js` checks.

## `napi_add_finalizer`
- **Wrong status for non-object.** Node [js_native_api_v8.cc:3640] returns `napi_invalid_arg`; Bun [napi.cpp:1163] returns `napi_object_expected`.
- **`result == nullptr` path is not tracked for env teardown.** Node creates a `ReferenceWithFinalizer` linked into `env->finalizing_reflist` [js_native_api_v8.cc:3644-3648], so the finalizer is guaranteed to run at env destruction (`FinalizeAll`). Bun [napi.cpp:1174-1177] uses `vm.heap.addFinalizer(...)` directly; if the object survives until the final GC after cleanup hooks have run, `NapiFinalizerTask::schedule()` silently drops it [napi_body.rs:4605-4617], so the user's finalizer never fires. Observable as a missing-finalize at shutdown.
- Argument validation order/semantics otherwise OK.

## `node_api_post_finalizer`
- **Extra null-check on `finalize_cb`.** Node [js_native_api_v8.cc:3658-3667] only does `CHECK_ENV(env)`; a null callback is accepted (enqueued, later no-ops in `Finalizer::CallFinalizer`). Bun [napi.cpp:1189] does `NAPI_CHECK_ARG(env, finalize_cb)` and returns `napi_invalid_arg`.
- **Extra pending-VM-exception check.** Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK` [napi.cpp:1188] which still does `NAPI_RETURN_IF_VM_EXCEPTION` → can return `napi_pending_exception`. Node never does; it is a `node_api_basic_env` function meant to be called from inside GC with no exception checks.
- Deferred execution: both defer to the event loop (Node `EnqueueFinalizer`→`SetImmediate` [node_api.cc:100-115]; Bun `napi_internal_enqueue_finalizer`→`NapiFinalizerTask::schedule` → `event_loop.enqueue_task` [napi_body.rs:4585-4628]). OK.

## `napi_get_last_error_info`
- **Error-message table is two entries short.** Node [js_native_api_v8.cc:926] has `last_status = napi_cannot_run_js` (24 entries). Bun [napi.cpp:218-246] stops at `napi_would_deadlock` (22 entries). When `last_error.error_code` is `napi_no_external_buffers_allowed` or `napi_cannot_run_js`, Bun writes `error_message = nullptr`; Node writes the proper string.

---

# Reference Semantics Deep Dive

### Any-value references in NAPI ≥ 10
Node 26 gates on `module_api_version < 10` [js_native_api_v8.cc:2829]: at v10+ **any** `napi_value` (including primitives and strings) may be passed to `napi_create_reference`. A value that fails `CanBeHeldWeakly` (anything but object/symbol) is stored strongly while `refcount>0` and **dropped** (via `persistent_.Reset()` in `SetWeak()` [js_native_api_v8.cc:751-756]) the moment refcount reaches 0. Bun gates on `nm_version == NAPI_VERSION_EXPERIMENTAL` [napi.cpp:1126], so v10 modules still get `napi_invalid_arg`. Bun should change the test to `>= 10`.

### 0 → 1 (weak → strong)
Node `Reference::Ref()` [js_native_api_v8.cc:690-700]: if `persistent_` is already empty (GC fired the weak callback), return 0 and do nothing; else increment, and on 0→1 call `ClearWeak()` so the single persistent becomes strong again.
Bun `NapiRef::ref()` [NapiRef.cpp:9-23]: unconditionally `++refCount`, and on 0→1 copy `weakValueRef.get()` into `strongRef`. There is no "already collected → return 0" branch, and `isClear()` is tag-based (still `Cell` after GC), so Bun can copy a null value into `strongRef`. **Observable difference**: post-GC `napi_reference_ref` writes 0 in Node, writes `refCount` (≥1) in Bun.

### 1 → 0 (strong → weak)
Node `Reference::Unref()` [js_native_api_v8.cc:702-712]: decrement; on reaching 0 call `SetWeak()` — sets a GC weak callback for object/symbol, or `Reset()` (drop) for everything else.
Bun `NapiRef::unref()` [NapiRef.cpp:25-34]: decrement (clamped); on 1→0 clear `strongRef` unless `m_isEternal`. The separate `weakValueRef` (installed once in `setValueInitial`) keeps the weak handle alive. For not-weakly-holdable values Bun installed no weak slot (`can_be_weak=false`), so clearing `strongRef` loses the value — matches Node's `Reset()`. The `m_isEternal` path for registered symbols is Bun-only (see `napi_create_reference` note above).

### GC callback / Finalize path
Node: weak callback → `persistent_.Reset()` → `InvokeFinalizerFromGC()`. A bare `Reference` (no finalizer — i.e. from `napi_create_reference`) runs `Finalize()` **immediately** inside GC [js_native_api_v8.cc:746-748], which just unlinks and, if `kRuntime`, self-deletes. A `ReferenceWithFinalizer` calls `env->InvokeFinalizerFromGC(this)` → for non-experimental modules enqueues to `pending_finalizers` drained via `SetImmediate` [node_api.cc:100-125]; for experimental modules sets `in_gc_finalizer=true` and runs synchronously [js_native_api_v8.cc:73-86].
Bun: `NapiRefWeakHandleOwner::finalize` [napi.cpp:287-291] runs the user finalizer via `callFinalizer()` → `NapiFinalizer::call(..., immediate = !mustDeferFinalizers() || !inGC())` [napi.h:840-847]. For non-experimental modules this defers via `napi_internal_enqueue_finalizer` → event-loop task; for experimental it runs synchronously. Matches Node's policy. The self-deleting variant (`NapiRefSelfDeletingWeakHandleOwner`, = `kRuntime`) additionally `delete weakValue` [napi.cpp:293-298] — equivalent to Node's `deleteMe` branch [js_native_api_v8.cc:729-742].
One divergence: Bun defers only the user finalizer callback, while Node defers the whole `Reference::Finalize()` (finalizer + possible self-delete). For `kRuntime` refs in Bun the `delete` happens **immediately in GC** after scheduling the finalizer task — so a user finalizer that later calls `napi_delete_reference` on that ref is UAF in Bun (it's already freed) but defined behavior in Node (double-delete is still UB there, but the pointer is valid until the deferred `Finalize()` runs). In practice `kRuntime` refs are never handed back to the user, so this is unlikely to be hit.

### Ownership model
Node's `ReferenceOwnership::{kUserland,kRuntime}` maps 1-for-1 onto Bun's two `WeakHandleOwner` subclasses:
- `kUserland` ↔ `NapiRefWeakHandleOwner` [napi.h:656-666] — finalize runs, ref is **not** deleted; user must `napi_delete_reference`.
- `kRuntime` ↔ `NapiRefSelfDeletingWeakHandleOwner` [napi.h:668-678] — finalize runs, ref self-deletes.

`napi_wrap` picks the owner by whether `result` is null [napi.cpp:883-888], matching Node [js_native_api_v8.cc:547-576]. `napi_add_finalizer` with `result != nullptr` is kUserland in both. `napi_add_finalizer` with `result == nullptr` is kRuntime in Node but a raw `heap.addFinalizer` in Bun (see above).

### `node_api_post_finalizer` deferral
Yes — Bun defers to the event loop via `NapiFinalizerTask` [napi_body.rs:4580-4628], equivalent to Node's `EnqueueFinalizer` + `SetImmediate`. OK.

---

## Files referenced
- `/workspace/bun/src/jsc/bindings/napi.cpp`
- `/workspace/bun/src/jsc/bindings/napi.h`
- `/workspace/bun/src/jsc/bindings/NapiRef.cpp`
- `/workspace/bun/src/jsc/bindings/NapiWeakValue.cpp`
- `/workspace/bun/src/jsc/bindings/napi_finalizer.h`
- `/workspace/bun/src/runtime/napi/napi_body.rs`
- `/tmp/node26_js_native_api_v8.cc`
- `/tmp/node26_js_native_api_v8.h`
- `/tmp/node26_node_api.cc`

---

# FINALIZER / GC-SAFETY ("basic env" / nogc) COMPARISON: Bun vs Node 26

## Summary

| Aspect | Node 26 | Bun |
|---|---|---|
| `node_api_basic_env` type | `typedef const napi_env__*` (compile-time const hint) | Not declared in Bun's own headers; runtime uses single `napi_env` type (same ABI, no runtime distinction — matches Node at runtime) |
| "in GC" detection | explicit `bool in_gc_finalizer` flag set around synchronous-from-GC finalizer invocation (`js_native_api_v8.cc:82-84`) | queries JSC heap state: `vm().isCollectorBusyOnCurrentThread()` (`napi.h:389-392`) |
| Version gate | `module_api_version == NAPI_VERSION_EXPERIMENTAL` (`js_native_api_v8.h:133`) | `m_napiModule.nm_version == NAPI_VERSION_EXPERIMENTAL` (`napi.h:398`) — matches |
| Fatal-error message | "Finalizer is calling a function that may affect GC state…" | Same wording (`napi.h:400-403`) — matches |
| Finalizer scheduling | non-EXPERIMENTAL → enqueue; EXPERIMENTAL → run in-GC with flag set | non-EXPERIMENTAL → `napi_internal_enqueue_finalizer`; EXPERIMENTAL → run immediately (`napi.h:415-427`) — matches |

---

## Q1: Does Bun distinguish `basic_env` from full `env`?

**No**, not at the type level. Neither does Node at **runtime** — `node_api_basic_env` is a `const`-qualified alias used only for compile-time warnings to addon authors. Bun declares all entry points with `napi_env`. This is **not** an observable behavioral difference (ABI is identical).

Bun's own internal header `/workspace/bun/src/runtime/napi/js_native_api_types.h` does not declare `node_api_basic_env` / `node_api_nogc_env` / `node_api_basic_finalize`, but addons compile against Node's headers, not Bun's, so this has no runtime impact.

---

## Q2: Does Bun block JS-touching calls during finalizer callbacks?

**Partially.** Bun has the mechanism (`NapiEnv::checkGC()` → fatal error, gated on `NAPI_VERSION_EXPERIMENTAL`), but it is **not wired into Bun's `NAPI_PREAMBLE` / `preamble!`**, whereas Node's `NAPI_PREAMBLE` **includes** `CHECK_ENV_NOT_IN_GC`.

- Node (`js_native_api_v8.h:233-234`):
  ```c
  #define NAPI_PREAMBLE(env) \
    CHECK_ENV_NOT_IN_GC((env)); \
    RETURN_STATUS_IF_FALSE((env), (env)->last_exception.IsEmpty(), napi_pending_exception); ...
  ```
- Bun C++ (`napi.cpp:89-95`):
  ```c
  #define NAPI_PREAMBLE(_env) \
    NAPI_CHECK_ARG(_env, _env); \
    auto napi_preamble_throw_scope__ = DECLARE_THROW_SCOPE(_env->vm()); \
    NAPI_RETURN_IF_EXCEPTION(_env)
  ```
  (no GC check)
- Bun Rust (`napi_body.rs:428-436`): `preamble!` = `get_env!` + pending-exception check — no `check_gc()`.

**Consequence:** every Bun entry point that relies only on `NAPI_PREAMBLE` / `preamble!` for its env check is **missing the GC-safety fatal error** that Node fires when the addon calls a JS-affecting function from an EXPERIMENTAL synchronous finalizer.

---

## Q3: Per-function gate comparison

### (A) Node `NAPI_PREAMBLE` functions where Bun is **missing** the GC check

All of the following use `NAPI_PREAMBLE` in Node (which includes `CHECK_ENV_NOT_IN_GC`) but use Bun's PREAMBLE variants **without** an explicit `NAPI_CHECK_ENV_NOT_IN_GC` / `env.check_gc()`:

**C++ (`napi.cpp`):**
- `napi_set_property` (l.396), `napi_has_property` (459), `napi_get_property` (495), `napi_delete_property` (532), `napi_has_own_property` (558)
- `napi_set_named_property` (598), `napi_has_named_property` (675), `napi_get_named_property` (695)
- `napi_set_element` (422), `napi_has_element` (440), `napi_get_element` (2657), `napi_delete_element` (2674)
- `napi_get_date_value` (479)
- `napi_wrap` (850), `napi_unwrap` (932), `napi_remove_wrap` (896)
- `napi_create_function` (954)
- `napi_define_properties` (997), `napi_define_class` (2162), `napi_get_all_property_names` (2039), `napi_get_property_names` (2266)
- `napi_object_freeze` (1799), `napi_object_seal` (1814)
- `napi_create_dataview` (1871), `napi_create_typedarray` (1969)
- `napi_coerce_to_string` (2194), `napi_coerce_to_bool` (2214), `napi_coerce_to_number` (2231), `napi_coerce_to_object` (2248)
- `napi_create_buffer` (2286), `napi_create_external_buffer` (2343), `napi_create_external_arraybuffer` (2388)
- `napi_create_external` (2710)
- `napi_run_script` (2947)
- `napi_create_bigint_words` (3019) — Node has `NAPI_PREAMBLE` (l.1886)
- `napi_new_instance` (3088), `napi_instanceof` (3122), `napi_call_function` (3157)
- `napi_type_tag_object` (3199), `napi_check_object_type_tag` (3219)
- `napi_fatal_exception` (1375)
- `napi_throw_error` (1108), `napi_throw_type_error` (1443), `napi_throw_range_error` (1793), `node_api_throw_syntax_error` (1436) — all use `NAPI_PREAMBLE_NO_THROW_SCOPE` with no GC check; Node uses `NAPI_PREAMBLE` for all of them. (Bun *does* GC-check `napi_throw` itself at l.1388.)
- `node_api_create_buffer_from_arraybuffer` (1580) — Node uses `NAPI_PREAMBLE`

**Rust (`napi_body.rs`):**
- `napi_get_prototype` (l.884), `napi_get_array_length` (970), `napi_strict_equals` (996)
- `napi_make_callback` (1176)
- `napi_create_promise` (1548), `napi_resolve_deferred` (1567), `napi_reject_deferred` (1586)
- `napi_create_date` (1631)
- `napi_create_buffer_copy` (2024)

### (B) Node `CHECK_ENV_NOT_IN_GC` (non-preamble) functions where Bun is **missing** the GC check

- `napi_is_buffer` (Bun C++ l.649, `NAPI_PREAMBLE_NO_PENDING_CHECK`, no GC) — Node has `CHECK_ENV_NOT_IN_GC` (node_api.cc:1142)
- `napi_is_typedarray` (Bun C++ l.662, no GC) — Node has `CHECK_ENV_NOT_IN_GC` (js_native_api_v8.cc:3258)
- `napi_get_buffer_info` (Bun Rust l.2064, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` (node_api.cc:1154)
- `napi_is_dataview` (Bun Rust l.1480, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` (js_native_api_v8.cc:3456)
- `napi_create_string_latin1` / `_utf8` / `_utf16` (Bun Rust l.620/676/717, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` via `CHECK_NEW_STRING_ARGS` (js_native_api_v8.cc:43-52)
- `node_api_create_external_string_latin1` / `_utf16` (Bun C++ l.1466/1511, no GC) — Node has `CHECK_ENV_NOT_IN_GC` via `CHECK_NEW_STRING_ARGS`
- `node_api_create_property_key_latin1` / `_utf8` / `_utf16` (Bun C++ l.1546-1571 delegate to `napi_create_string_*`) — same missing GC check
- `napi_create_bigint_int64` / `_uint64` (Bun C++ l.3003/2991, no GC) — Node has `CHECK_ENV_NOT_IN_GC` (js_native_api_v8.cc:1865/1877)
- `napi_async_init` (Bun Rust l.1138, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` (node_api.cc:963)
- `napi_async_destroy` (Bun Rust l.1155, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` (node_api.cc:990)
- `napi_create_async_work` (Bun Rust l.2150, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` (node_api.cc:1277)
- `napi_delete_async_work` (Bun Rust l.2171, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` (node_api.cc:1307)
- `napi_create_threadsafe_function` (Bun Rust l.3060, no `check_gc()`) — Node has `CHECK_ENV_NOT_IN_GC` (node_api.cc:1363)

### (C) Functions where **both** match (Bun has explicit GC check == Node)

OK — `napi_get_undefined`, `napi_get_null`, `napi_get_boolean`, `napi_create_array`, `napi_create_array_with_length`, `napi_create_int32/uint32/int64`, `napi_create_double`, `napi_create_object`, `napi_create_symbol`, `node_api_symbol_for`, `napi_create_error/type_error/range_error`, `node_api_create_syntax_error`, `napi_typeof`, `napi_is_array`, `napi_is_error`, `napi_is_arraybuffer`, `napi_is_promise`, `napi_is_date`, `napi_get_global`, `napi_get_new_target`, `napi_get_value_double/int32/uint32/int64/bool`, `napi_get_value_bigint_int64/uint64/words`, `napi_get_value_string_utf8/latin1/utf16`, `napi_get_value_external`, `napi_get_arraybuffer_info`, `napi_get_typedarray_info`, `napi_get_dataview_info`, `napi_create_reference`, `napi_reference_ref/unref`, `napi_get_reference_value`, `napi_add_finalizer`, `napi_open/close_handle_scope`, `napi_open/close_escapable_handle_scope`, `napi_escape_handle`, `napi_is_detached_arraybuffer`, `napi_detach_arraybuffer`, `napi_is_exception_pending`, `napi_get_and_clear_last_exception`, `node_api_is_sharedarraybuffer`, `napi_throw`, `napi_create_arraybuffer`, `node_api_set_prototype`, `node_api_create_sharedarraybuffer`, `node_api_create_external_sharedarraybuffer`, `node_api_create_object_with_properties`.

### (D) `node_api_basic_env` (GC-safe) functions — Node uses `CHECK_ENV` only

All of these are correctly **not** GC-gated in Bun (matches Node):
- `napi_get_last_error_info`, `napi_delete_reference`, `napi_get_version`, `node_api_post_finalizer`, `napi_adjust_external_memory`, `napi_set_instance_data`, `napi_get_instance_data`, `napi_add_env_cleanup_hook`, `napi_remove_env_cleanup_hook`, `napi_add_async_cleanup_hook`, `napi_get_node_version`, `napi_get_uv_event_loop`, `napi_queue_async_work`, `napi_cancel_async_work`, `napi_ref_threadsafe_function`, `napi_unref_threadsafe_function`, `node_api_get_module_file_name`, `napi_get_cb_info`.

**OK** — Bun does not erroneously gate any basic-env-safe function.

### (E) Functions Bun GC-gates that Node does **not** (over-gating)

None found. (`napi_get_cb_info` uses Bun `NAPI_PREAMBLE_NO_PENDING_CHECK` with no GC check — Node uses `CHECK_ENV` only, so this is correct.)

---

## Mechanism difference (non-function-specific)

- **`in_gc_finalizer` flag vs VM query.** Node sets/clears a boolean scoped exactly to the synchronous-from-GC finalizer call (`js_native_api_v8.cc:81-85`). Bun instead evaluates `vm().isCollectorBusyOnCurrentThread()` at each `checkGC()` call site (`napi.h:389-391`). Because Bun only runs finalizers synchronously during GC for EXPERIMENTAL modules (`napi.h:415-427`, `mustDeferFinalizers()` at l.487-498), and `checkGC()` is itself gated on EXPERIMENTAL, the practical scope is equivalent. Edge case: if JSC reports `isCollectorBusyOnCurrentThread()` in contexts other than a synchronous weak-callback (e.g. other heap phases on the JS thread), Bun could fire the fatal error where Node would not. Not verified to occur in practice.

- **Version field.** Node reads `module_api_version` (assigned at env creation from the addon's declared version). Bun reads `m_napiModule.nm_version`. Same intent; relies on the module's declared version being propagated into `nm_version` at load time.

---

## Relevant files

- `/workspace/bun/src/jsc/bindings/napi.cpp` — `NAPI_PREAMBLE` at l.89 (no GC check), `NAPI_CHECK_ENV_NOT_IN_GC` at l.125.
- `/workspace/bun/src/jsc/bindings/napi.h` — `inGC()` l.389, `checkGC()` l.394, `doFinalizer()` l.415, `mustDeferFinalizers()` l.487.
- `/workspace/bun/src/runtime/napi/napi_body.rs` — `preamble!` l.428 (no GC check), `check_gc()` l.124.
- `/tmp/node26_js_native_api_v8.h` — `CheckGCAccess()` l.132, `in_gc_finalizer` l.163, `CHECK_ENV_NOT_IN_GC` l.213, `NAPI_PREAMBLE` l.233.
- `/tmp/node26_js_native_api_v8.cc` — `InvokeFinalizerFromGC` l.73-86.

---

# ThreadSafeFunction Deep Dive: Bun vs Node 26

Files compared:
- Bun: `/workspace/bun/src/runtime/napi/napi_body.rs` lines 2410–3225
- Node: `/tmp/node26_node_api.cc` lines 203–585, 1352–1454

---

## `napi_create_threadsafe_function`

- **Missing `async_resource_name` null‑check.** Node line 1364: `CHECK_ARG(env, async_resource_name)` → returns `napi_invalid_arg` if `NULL`. Bun (line 3063–3064) ignores `_async_resource_name` entirely; passing `NULL` succeeds in Bun but fails with `napi_invalid_arg` in Node.
- **Missing `initial_thread_count > 0` check.** Node line 1365: `RETURN_STATUS_IF_FALSE(env, initial_thread_count > 0, napi_invalid_arg)`. Bun (line 3112) accepts `initial_thread_count == 0` and creates a TSFN with `thread_count = 0` (it will finalize on first dispatch). Observable status‑code difference.
- **Wrong status when `func == NULL && call_js_cb == NULL`.** Node line 1372: `CHECK_ARG(env, call_js_cb)` → `napi_invalid_arg`. Bun line 3082 returns `napi_function_expected`.
- **Wrong status when `func` is non‑null but not a Function.** Node line 1374 `CHECK_TO_FUNCTION` → `napi_invalid_arg`. Bun line 3082 returns `napi_function_expected`.
- **`func` is not type‑checked when `call_js_cb` is supplied.** Node always runs `CHECK_TO_FUNCTION` on a non‑null `func` (line 1373–1374), regardless of `call_js_cb`. Bun’s check at line 3078 is gated on `call_js_cb.is_none()`, so a non‑function `func` is silently stored (and later handed to `call_js_cb`) if the addon also supplied `call_js_cb`.
- **Missing "not in GC" check.** Node line 1363: `CHECK_ENV_NOT_IN_GC(env)`. Bun line 3074 uses `get_env!` only (no `checkGC()` path). Relevant only for `NAPI_VERSION_EXPERIMENTAL` modules, but a real divergence.
- **`async_resource` / `async_resource_name` coercion checks skipped.** Node lines 1383/1387 run `CHECK_TO_OBJECT` / `CHECK_TO_STRING` (can return `napi_object_expected` / `napi_string_expected`). Bun ignores both arguments entirely.

## `napi_get_threadsafe_function_context`
OK (both crash on null inputs — Node via `CHECK_NOT_NULL` abort, Bun via deref; neither returns a status code).

## `napi_call_threadsafe_function` (Push)
- **Blocking / non‑blocking queue semantics:** OK — both treat `max_queue_size == 0` as unlimited (Bun `is_blocked()` at line 2507; Node loop condition at line 242), and both re‑check closing after waking.
- **Abort‑while‑queued divergence (items still in queue when closing):**
  In **Node**, once `state != kOpen` (after `napi_tsfn_abort` or env cleanup), `DispatchOne` (line 424) refuses to pop and jumps straight to `CloseHandlesAndMaybeDelete`; remaining items are later drained by `EmptyQueue()` (line 311) which invokes `call_js_cb(nullptr, nullptr, context, data)` — i.e. with **`env == NULL` and `js_callback == NULL`**.
  In **Bun**, `dispatch_one` (line 2651) has no `closing` gate: it keeps popping and calling `call()` with the **live env and live `js_callback`** until the queue is empty. An addon that relies on the documented "after abort, queued items are returned via `call_js_cb(NULL, NULL, …)` so you can free the data but must not call into JS" will observe different behavior (it gets real env/js calls in Bun).
- **`napi_closing` path triggers extra dispatch.** When the TSFN is already `Closing` and `push` consumes the caller’s reference, Bun’s `release_locked` (called from line 2800) may `schedule_dispatch()` (line 3036). Node’s `Push` (lines 255–265) only decrements and possibly `delete this`; it does not `Send()`. Not usually observable but a scheduling difference.

## `napi_acquire_threadsafe_function`
OK.

## `napi_release_threadsafe_function`
- **Condvar wake on abort: `broadcast` vs `Signal`.** Node line 296: `cond->Signal(lock)` (wakes one blocked producer). Bun line 3028: `self.blocking_condvar.broadcast()` (wakes all). With multiple producers blocked on a full bounded queue, Node may leave some producers sleeping after abort; Bun wakes them all. Observable in multi‑producer addons (Bun is arguably safer, but different from Node).
- **Finalize callback timing after abort.** Node: abort → `Send()` → `DispatchOne` sees `state != kOpen` → `CloseHandlesAndMaybeDelete` → `Finalize()` runs the `finalize_cb` **immediately in the next uv_close callback, even while `thread_count > 0`** (resources are released, object kept alive for remaining threads via `MaybeDelete`/`ReleaseResources`). Bun: abort only sets `closing = Closing` and schedules dispatch; `maybe_queue_finalizer` is reached only when `thread_count == 0` (lines 2662/2672). So in Bun the **`thread_finalize_cb` is deferred until every thread has released**, whereas Node runs it promptly after abort regardless of remaining thread references. Observable.
- **Extra dispatch when last release arrives after an earlier abort.** Bun line 3032–3036 schedules another dispatch when `prev_remaining == 1` and already closing; Node line 290–299 is a no‑op in that case (`state != kOpen`). Minor, not normally observable.

## `napi_ref_threadsafe_function` / `napi_unref_threadsafe_function`
- **Bun null‑checks `env`; Node does not.** Node (lines 1444–1453) ignores `env` entirely (it’s a `node_api_basic_env`) and always returns `napi_ok`. Bun lines 3201/3217 run `get_env!(env_)`, so a `NULL` env returns `napi_invalid_arg` in Bun but `napi_ok` in Node.
- **`last_error` handling.** Bun calls `env.ok()` (line 3208/3224) which sets `last_error = napi_ok`. Node returns `napi_ok` without touching `last_error`. An addon that reads `napi_get_last_error_info` immediately after will see a cleared error in Bun but the previous error in Node.
- **Null‑func handling.** Node `CHECK_NOT_NULL(func)` aborts; Bun derefs without check (UB → crash). Effectively equivalent.

## Dispatch loop — iteration cap
- **No 1000‑iteration limit in Bun.** Node line 401–414 caps a single `Dispatch()` at `kMaxIterationCount = 1000` and re‑`Send()`s if more remain, to avoid event‑loop starvation. Bun line 2602 explicitly opts out ("We don't set a max"). A TSFN being flooded from many threads can starve the event loop in Bun but not in Node.

## `call_js_cb` invocation — `js_callback` argument value
- **When no `func` was supplied, Node passes `NULL`; Bun passes a napi_value for `undefined`.** Node `DispatchOne` line 455–460: `napi_value js_callback = nullptr; if (!ref.IsEmpty()) { … }`. Bun `call()` line 2734/2741: `cb_js.get().unwrap_or(JSValue::UNDEFINED)` → `napi_value::create(env, UNDEFINED)`, which is a non‑zero encoded JSValue (JSC’s `undefined` tag). Addons that test `if (js_callback != NULL)` will take the wrong branch in Bun.

## Finalizer execution path (normal, non‑abort shutdown)
- **Finalizer is deferred through a separate task in Bun.** Node `Finalize()` (line 468) calls `env->CallFinalizer<false>(finalize_cb, …)` synchronously inside the `uv_close` callback. Bun `destroy()` line 2860 calls `finalizer.enqueue()` → `NapiFinalizerTask::init(self).schedule()` (line 2378–2380), so the `thread_finalize_cb` runs at least one extra event‑loop turn later than in Node. Observable ordering difference vs. other async work scheduled at the same time.
- **No `EmptyQueue` equivalent on the normal‑shutdown `destroy` path.** Node always calls `EmptyQueue()` before `finalize_cb` (line 470). Bun’s `destroy` (line 2839) does not drain the queue. In Bun’s normal flow the queue is already empty by construction (finalizer only queued when queue drained), so this is not observable on its own — but combined with the "Bun keeps dispatching after abort" point above, Bun never delivers the `env=NULL` drain callbacks that Node guarantees on abort. (Bun *does* do the `env=NULL` drain in `env_teardown` at line 2918–2921, matching Node’s `Cleanup` path.)

## Env teardown (`Cleanup`)
- **Condvar: Bun broadcasts, Node signals.** Bun `env_teardown` line 2900 `broadcast()`. Node `CloseHandlesAndMaybeDelete(true)` line 484 `Signal(lock)`. Same observable difference as the abort case above.
- Otherwise Bun’s `env_teardown` (lines 2886–2952) mirrors Node’s `Cleanup → CloseHandlesAndMaybeDelete(true) → Finalize → EmptyQueue + finalize_cb → MaybeDelete` closely (drain with `env=NULL`, run finalizer synchronously, then release resources / free when `thread_count==0`).

## `max_queue_size == 0` (unlimited)
OK — both never block; both guard condvar signalling with `max_queue_size > 0`.

## thread_count management
- Both return `napi_invalid_arg` from `Release`/`Push` when `thread_count` is already 0 (Node lines 255/284; Bun lines 2794/3004).
- Bun uses a signed `AtomicI64` and checks `<= 0` (defensive against user over‑release). Node uses `size_t`. Not observable in correctly‑behaving addons.

---

### Summary of observable semantic differences

| Area | Node 26 | Bun |
|---|---|---|
| `async_resource_name == NULL` | `napi_invalid_arg` | `napi_ok` |
| `initial_thread_count == 0` | `napi_invalid_arg` | `napi_ok` |
| `func==NULL && call_js_cb==NULL` | `napi_invalid_arg` | `napi_function_expected` |
| non‑function `func` | `napi_invalid_arg` | `napi_function_expected` (only if `call_js_cb==NULL`; else no check) |
| After abort, queued items | delivered via `call_js_cb(NULL, NULL, ctx, data)` | dispatched normally with live env/js |
| Finalize timing after abort | runs before remaining threads release | deferred until `thread_count==0` |
| Finalize timing (normal) | sync in `uv_close` cb | enqueued as a later task |
| `js_callback` when no `func` | `NULL` | napi_value encoding `undefined` (non‑zero) |
| Dispatch iteration cap | 1000 per tick | unlimited |
| Condvar wake on abort/teardown | `Signal` (one waiter) | `broadcast` (all waiters) |
| `napi_{ref,unref}_threadsafe_function` with `env==NULL` | `napi_ok` | `napi_invalid_arg` |
| `napi_{ref,unref}_threadsafe_function` last_error | untouched | cleared to `ok` |

---

