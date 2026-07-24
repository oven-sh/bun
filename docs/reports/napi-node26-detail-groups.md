## error handling & status

# N-API Error Handling & Status — Bun vs Node 26

## napi_get_last_error_info
- **Missing error messages for 2 status codes** (napi.cpp:219, `last_status = napi_would_deadlock`). Node 26 has `last_status = napi_cannot_run_js` and includes `"External buffers are not allowed"` and `"Cannot run JavaScript"` in the table. Bun *does* return `napi_cannot_run_js` (napi.cpp:1390), so after that call `napi_get_last_error_info` will set `error_message = nullptr` instead of `"Cannot run JavaScript"`.
- Node does `if (error_code == napi_ok) napi_clear_last_error(env);` (resets `engine_error_code`/`engine_reserved`); Bun does not. Not currently observable because Bun never sets those fields, but it is a divergence.

## napi_throw
- **GC-check ordering**: Bun `NAPI_PREAMBLE` (napi.cpp:1387) checks pending-exception *before* `NAPI_CHECK_ENV_NOT_IN_GC`. Node's `NAPI_PREAMBLE` runs `CheckGCAccess()` first. For an `NAPI_VERSION_EXPERIMENTAL` module calling from a GC finalizer while an exception is pending, Node aborts; Bun returns `napi_pending_exception`. Minor.
- Otherwise OK (env, pending-exception, cannot-run-js, and `error != NULL` checks all present).

## napi_throw_error / napi_throw_type_error / napi_throw_range_error / node_api_throw_syntax_error
All four share `throwErrorWithCStrings` via `NAPI_PREAMBLE_NO_THROW_SCOPE` (napi.cpp:1104/1440/1790/1432):
- **Missing pending-exception check.** Node uses `NAPI_PREAMBLE`, which returns `napi_pending_exception` if `env->last_exception` is non-empty. Bun's `NAPI_PREAMBLE_NO_THROW_SCOPE` only checks `env != NULL`. Result: calling `napi_throw_error` while an exception is already pending returns `napi_ok` in Bun (and overwrites `m_pendingException`), vs `napi_pending_exception` in Node.
- **Missing "not in GC" check.** Node's `NAPI_PREAMBLE` → `CHECK_ENV_NOT_IN_GC` calls `CheckGCAccess()`; Bun never calls `checkGC()` here.
- **Missing `can_call_into_js` / `napi_cannot_run_js` check.** Node returns `napi_cannot_run_js` (module_api_version ≥ 10) or `napi_pending_exception` when the env cannot run JS; Bun has no equivalent gate here.
- msg-null → `napi_invalid_arg`: OK (matches Node's `CHECK_NEW_FROM_UTF8`).

## napi_is_error
Implemented in Rust (`napi_body.rs:1320`):
- **Missing null check on `result`.** Node does `CHECK_ARG(env, result)`; Bun writes `*result` unconditionally (line 1333). A null `result` returns `napi_invalid_arg` in Node but segfaults in Bun.
- Bun's `is_any_error()` (bindings.cpp:3583) also returns `true` for a `JSC::Exception` wrapper cell; V8 `IsNativeError()` does not. In practice a `napi_value` is never a raw `JSC::Exception`, so this is not normally observable.

## napi_create_error / napi_create_type_error / napi_create_range_error / node_api_create_syntax_error
All four share `createErrorWithNapiValues` (napi.cpp:1078):
- **Arg-check order swapped**: Bun checks `result` then `msg` (napi.cpp:1084-1085); Node checks `msg` then `result`. Both paths return `napi_invalid_arg` either way, so the returned status is identical — not observable.
- Otherwise OK: env-null, not-in-gc, msg-must-be-string (`napi_string_expected`), code-must-be-string-or-null (`napi_string_expected`), no pending-exception check — all match Node's `CHECK_ENV_NOT_IN_GC` semantics.

## napi_get_and_clear_last_exception
OK. (env-null, not-in-gc, result-null checks match; returns `undefined` when none pending; clears last_error.)

## napi_is_exception_pending
- **Missing env-null check** (napi.cpp:1322). Bun goes straight to `NAPI_CHECK_ENV_NOT_IN_GC(env)` which expands to `(env)->checkGC()` — this dereferences `env`. Node's `CHECK_ENV_NOT_IN_GC` first does `CHECK_ENV(env)` → returns `napi_invalid_arg`. Calling `napi_is_exception_pending(NULL, &r)` returns `napi_invalid_arg` in Node but crashes in Bun.
- Bun additionally inspects the JSC VM exception slot (napi.cpp:1335-1341) while Node only inspects `env->last_exception`. This can make Bun report `true` where Node reports `false` (e.g., a VM exception not stashed via napi). This is a deliberate JSC-vs-V8 accommodation but is observably different.

## napi_fatal_exception
- **Missing "not in GC" check.** Node uses `NAPI_PREAMBLE` → `CHECK_ENV_NOT_IN_GC`. Bun's `NAPI_PREAMBLE` (napi.cpp:1375) does not call `checkGC()`, and there is no separate `NAPI_CHECK_ENV_NOT_IN_GC` here.
- **Missing `can_call_into_js` gate.** Node's `NAPI_PREAMBLE` returns `napi_cannot_run_js`/`napi_pending_exception` if the env can't run JS; Bun has no equivalent here.
- env-null, pending-exception, and `err`-null checks: OK.

## napi_fatal_error
- **Null-pointer handling differs.** Bun's `napi_span` (napi_body.rs:1967) returns an empty slice for a null `location`/`message`; Node dereferences them (via `strlen`/`std::string::assign`) and would crash on `(NULL, NAPI_AUTO_LENGTH)`. Bun is more lenient.
- **Empty-message substitution.** Bun replaces an empty message with `"fatal error"` (napi_body.rs:1990-1992); Node prints the empty string.
- **Output format differs.** Node calls `node::OnFatalError(location, message)` (prints `FATAL ERROR: <location> <message>`); Bun prints `NAPI FATAL ERROR: <location> <message>` (with location) or `napi: <message>` (without). Observable to anything parsing stderr.
- Both are `NAPI_NO_RETURN` and abort: OK.

---

### Key files
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 90-260, 1030-1110, 1322-1400, 1422-1455, 1782-1847)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 125-130 `NAPI_CHECK_ENV_NOT_IN_GC`, 429-458 `scheduleException`/`hasPendingException`)
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 1320-1335 `napi_is_error`, 1964-2004 `napi_fatal_error`)
- `/tmp/node26_js_native_api_v8.cc` (lines 889-939, 1965-2070, 2219-2316, 3064-3090)
- `/tmp/node26_node_api.cc` (lines 893-922)

---

## value creation (primitives)

# N-API Comparison: Value Creation (Primitives)

## Macro semantics summary (for reference)

| | Node 26 | Bun Rust | Bun C++ |
|---|---|---|---|
| env null check | `CHECK_ENV` → `napi_invalid_arg` | `get_env!` → `napi_invalid_arg` | `NAPI_CHECK_ARG(_env,_env)` → `napi_invalid_arg` |
| GC check | `CheckGCAccess()` (fatal if experimental + in-GC) | `env.check_gc()` (same) | `NAPI_CHECK_ENV_NOT_IN_GC` (same) |
| result null check | `CHECK_ARG` → `napi_invalid_arg` | `get_out!` → `napi_invalid_arg` | `NAPI_CHECK_ARG` → `napi_invalid_arg` |
| success | `napi_clear_last_error` → `napi_ok` | `env.ok()` → `napi_ok` | `NAPI_RETURN_SUCCESS` → `napi_ok` |

All Node 26 functions in this group use only `CHECK_ENV_NOT_IN_GC` + `CHECK_ARG(result)` (no `NAPI_PREAMBLE`, i.e. **no** pending-exception check).

---

### napi_get_undefined
OK — Bun Rust `napi_body.rs:485‑495`: `get_env!` → `check_gc` → `get_out!(result)` → write → `ok()`. Matches Node `js_native_api_v8.cc:2114‑2121` (env/GC/arg order, status codes, no pending-exception check).

### napi_get_null
OK — Bun Rust `napi_body.rs:498‑505`. Same pattern as above; matches Node `:2123‑2130`.

### napi_get_global
- Bun C++ `napi.cpp:1828‑1837` uses `NAPI_PREAMBLE_NO_PENDING_CHECK` (line 1830) which, after the env‑null check, runs `NAPI_RETURN_IF_VM_EXCEPTION` (napi.cpp:114/149). If a JSC **VM‑level** exception is already set on entry, Bun returns `napi_pending_exception`; Node 26 (`:2210‑2217`) has no such check and always succeeds. Note: exceptions stashed via `napi_throw` live in `m_pendingException`, not the VM slot, so this path only fires with a raw JSC exception on the stack — arguably JSC‑inherent, but technically observable.
- Otherwise equivalent (env → GC → result‑null → write → ok).

### napi_get_boolean
OK — Bun Rust `napi_body.rs:512‑523`. Matches Node `:1908‑1923` (same checks/order, no pending‑exception check).

### napi_create_double
- Bun C++ `napi.cpp:2417‑2427`: same minor note as `napi_get_global` — `NAPI_PREAMBLE_NO_PENDING_CHECK` at line 2420 returns `napi_pending_exception` if a JSC VM exception is already pending; Node `:1814‑1824` does not gate on any exception.
- Otherwise OK (env/GC/result checks and status codes match; `purifyNaN` is JSC NaN‑boxing hygiene, not a semantic difference).

### napi_create_int32
OK — Bun Rust `napi_body.rs:578‑589`. Matches Node `:1826‑1836`.

### napi_create_uint32
OK — Bun Rust `napi_body.rs:592‑603`. Matches Node `:1838‑1848`.

### napi_create_int64
OK — Bun Rust `napi_body.rs:606‑617`. Both cast to double; matches Node `:1850‑1860`.

### napi_create_object
- Bun C++ `napi.cpp:2688‑2703`: same minor note as `napi_get_global` — `NAPI_PREAMBLE_NO_PENDING_CHECK` at line 2690 adds a VM‑exception early‑return not present in Node `:1612‑1619`.
- Otherwise OK (env/GC/result checks and status codes match).

### napi_create_array
OK — Bun Rust `napi_body.rs:526‑540`. `get_env!` → `check_gc` → `get_out!(result)` → create → `ok()`; no pending‑exception gate, matching Node `:1665‑1672`. (Bun has an extra `napi_pending_exception` return on line 536 if array allocation throws in JSC; V8 OOM‑aborts instead, so this path has no Node analogue — JSC‑inherent.)

### napi_create_array_with_length
OK — Bun Rust `napi_body.rs:543‑567`. Checks/order match Node `:1674‑1684`. Length handling at lines 556‑558 (`usize → i64 → i32`, clamp `<0` to `0`) reproduces V8's implicit `size_t → int` narrowing + `Array::New`'s `if (length < 0) length = 0` (referenced by the code comment), so edge‑case behavior for huge/overflowing lengths matches.

---

## Summary

All 11 functions are behaviorally equivalent with respect to argument‑validation order, null checks, status codes, GC checks, and (absence of) pending‑exception gating.

The only observable divergence is that the three **C++‑implemented** functions (`napi_get_global`, `napi_create_double`, `napi_create_object`) will return `napi_pending_exception` if a JSC VM exception is already on the stack at entry (via `NAPI_PREAMBLE_NO_PENDING_CHECK` → `NAPI_RETURN_IF_VM_EXCEPTION`, `napi.cpp:110‑114,149`), whereas Node 26 never checks for a pending exception in these functions. This does **not** trigger for the normal `napi_throw` path (which stashes into `m_pendingException`, not the VM slot) and is largely a JSC exception‑scope safety requirement.

Relevant files:
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 87‑127, 415‑446, 485‑617)
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 89‑173, 186‑193, 1828‑1837, 2417‑2427, 2688‑2703)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 389‑408)
- `/tmp/node26_js_native_api_v8.cc` (lines 1612‑1684, 1814‑1923, 2114‑2130, 2210‑2217)
- `/tmp/node26_js_native_api_v8.h` (lines 132‑143, 171‑244)

---

## string creation

I now have enough information to compare each function. Here is the analysis:

---

# N-API String Creation — Bun vs Node 26

## `napi_create_string_latin1`
- **Missing "not in GC" check.** Node runs `CHECK_ENV_NOT_IN_GC` (via `CHECK_NEW_STRING_ARGS`, /tmp/node26_js_native_api_v8.cc:45) which aborts if called from a GC finalizer under `NAPI_VERSION_EXPERIMENTAL`. Bun's implementation (`/workspace/bun/src/runtime/napi/napi_body.rs:626`) only does `get_env!` + `get_out!`; `env.check_gc()` is never called.
- Otherwise OK (arg-validation order differs but all failure paths yield `napi_invalid_arg`, so not observable).

## `napi_create_string_utf8`
- **Missing "not in GC" check.** Same as above — no `env.check_gc()` at `/workspace/bun/src/runtime/napi/napi_body.rs:682`.
- **Wrong status on creation failure.** At `/workspace/bun/src/runtime/napi/napi_body.rs:710` Bun returns `NapiStatus::pending_exception` when JSC string creation fails. Node returns `napi_generic_failure` (via `CHECK_MAYBE_EMPTY` in `NewString`, /tmp/node26_js_native_api_v8.cc:101). Bun's own `latin1`/`utf16` variants correctly return `generic_failure` (lines 658/669/759/770), so `utf8` is inconsistent with both Node and with Bun's other two.

## `napi_create_string_utf16`
- **Missing "not in GC" check.** No `env.check_gc()` at `/workspace/bun/src/runtime/napi/napi_body.rs:723`.
- Otherwise OK.

## `node_api_create_external_string_latin1`
Bun impl: `/workspace/bun/src/jsc/bindings/napi.cpp:1457-1499`. Node impl: /tmp/node26_js_native_api_v8.cc:1720 + `NewExternalString`/`CHECK_NEW_STRING_ARGS`.
- **Extra pending-exception check (stricter than Node).** Bun bails with `napi_pending_exception` if either a VM exception (line 1466 via `NAPI_PREAMBLE_NO_PENDING_CHECK` → `NAPI_RETURN_IF_VM_EXCEPTION`) or an env-stashed `napi_throw*` exception (line 1471) is pending. Node uses only `CHECK_NEW_STRING_ARGS` (no `NAPI_PREAMBLE`), so it succeeds even while an exception is pending. An addon that creates an external string after `napi_throw` gets `napi_ok` in Node but `napi_pending_exception` in Bun.
- **Unconditional `str` null-check.** Bun line 1467: `NAPI_CHECK_ARG(env, str)` always. Node only checks `str != nullptr` when `length > 0` (/tmp/node26_js_native_api_v8.cc:46). So `(str=NULL, length=0)` → Node returns `napi_ok` with an empty string; Bun returns `napi_invalid_arg`.
- **Missing `length <= INT_MAX` check.** Node rejects `length` that is neither `NAPI_AUTO_LENGTH` nor `<= INT_MAX` with `napi_invalid_arg` (/tmp/node26_js_native_api_v8.cc:48-51). Bun has no such check; it goes straight to `static_cast<unsigned int>(length)` at line 1488, silently truncating oversize lengths instead of returning `napi_invalid_arg`.
- **Missing "not in GC" check.** `NAPI_PREAMBLE_NO_PENDING_CHECK` does not call `checkGC()`; Node's `CHECK_NEW_STRING_ARGS` does (`CHECK_ENV_NOT_IN_GC`).

## `node_api_create_external_string_utf16`
Bun impl: `/workspace/bun/src/jsc/bindings/napi.cpp:1502-1544`. Same four differences as `node_api_create_external_string_latin1`:
- Extra pending-exception check at lines 1511/1516 (Node has none).
- Unconditional `str` null-check at line 1512 (Node only checks when `length > 0`; `(NULL, 0)` diverges).
- Missing `length <= INT_MAX` check (Bun truncates via `static_cast<unsigned int>(length)` at line 1533 instead of returning `napi_invalid_arg`).
- Missing "not in GC" check.

## `node_api_create_property_key_latin1`
Bun (`/workspace/bun/src/jsc/bindings/napi.cpp:1546`) delegates to `napi_create_string_latin1`, so it inherits:
- **Missing "not in GC" check** (same as `napi_create_string_latin1`).
- Otherwise OK (internalized-vs-normal string type is a perf hint, not semantically observable).

## `node_api_create_property_key_utf8`
Bun (`/workspace/bun/src/jsc/bindings/napi.cpp:1564`) delegates to `napi_create_string_utf8`, so it inherits:
- **Missing "not in GC" check.**
- **Wrong status on creation failure** (`pending_exception` instead of Node's `generic_failure`, via underlying `napi_create_string_utf8` line 710).

## `node_api_create_property_key_utf16`
Bun (`/workspace/bun/src/jsc/bindings/napi.cpp:1555`) delegates to `napi_create_string_utf16`, so it inherits:
- **Missing "not in GC" check** (same as `napi_create_string_utf16`).
- Otherwise OK.

---

### Relevant file paths
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 415-446 macros, 620-774 string fns)
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 89-173 macros, 1456-1571 external/property-key string fns)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 389-408 `checkGC()`)
- `/tmp/node26_js_native_api_v8.cc` (lines 43-52 `CHECK_NEW_STRING_ARGS`, 92-136 `NewString`/`NewExternalString`, 1686-1813 impls)
- `/tmp/node26_js_native_api_v8.h` (lines 132-143 `CheckGCAccess`, 191-240 macros)

---

## string reading

## String Reading Functions — Comparison Report

All three functions (`napi_get_value_string_latin1`, `napi_get_value_string_utf8`, `napi_get_value_string_utf16`) are implemented in Bun by thin wrappers at `/workspace/bun/src/jsc/bindings/napi.cpp:2614-2639` that delegate to a single templated helper `napi_get_value_string_any_encoding` at `napi.cpp:2515-2612`. The Rust side (`/workspace/bun/src/runtime/napi/napi_body.rs:831-859`) only forward-declares the C++ symbols. Findings below apply to all three unless noted.

---

### `napi_get_value_string_latin1`
**OK** (see shared note below).

### `napi_get_value_string_utf8`
**OK** (see shared note below).

### `napi_get_value_string_utf16`
**OK** (see shared note below).

---

### Shared analysis (all three)

Matching behavior:
- env null → `napi_invalid_arg`; not‑in‑GC check; `value == NULL` → `napi_invalid_arg`; non‑string → `napi_string_expected`; `buf == NULL && result == NULL` → `napi_invalid_arg`; `bufsize == 0` → writes `0` to `*result` (if non‑null) and returns `napi_ok` with no terminator; success sets last_error to `napi_ok`. Validation order matches Node. `NAPI_AUTO_LENGTH`/oversized `bufsize` is explicitly clamped (napi.cpp:2564‑2571) and yields the same result as Node/V8 stopping at end of string.

Minor difference (borderline JSC‑inherent):
- **Pre‑existing VM exception on entry.** Node uses `CHECK_ENV_NOT_IN_GC` only (no pending‑exception check of any kind). Bun's helper begins with `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:2517 → macro at napi.cpp:110‑114), which correctly does **not** check the env‑stashed `napi_throw*` exception (matching Node), but it **does** execute `NAPI_RETURN_IF_VM_EXCEPTION` immediately after declaring the throw scope. If a JSC VM‑level exception is already pending when the addon calls in, Bun returns `napi_pending_exception` before doing the `value`/`isString` checks; Node proceeds and returns `napi_invalid_arg` / `napi_string_expected` / `napi_ok` regardless of any pending exception. In normal N‑API flow this is unlikely to be observable (Bun's `napi_throw` stashes on `env`, not the VM), so this is largely a JSC implementation detail.

Encoding‑semantics caveat (not a validation/status issue, but potentially observable):
- **utf8**: Node passes `v8::String::WriteFlags::kReplaceInvalidUtf8` (node26_js_native_api_v8.cc:2563), so lone surrogates become U+FFFD (3 bytes) and partial multi‑byte sequences are never emitted when truncating. Bun routes through `Bun__encoding__writeUTF16`/`writeLatin1` (napi.cpp:2580‑2596). If Bun's UTF‑8 encoder and `Bun__encoding__byteLengthUTF16AsUTF8` handle lone surrogates or truncation‑at‑char‑boundary differently from V8, the byte count and buffer contents could differ. Not a status/null‑check bug, but worth a conformance test.

Files referenced:
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 99‑173 macros, 2515‑2639 impl)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 389‑408 `checkGC`)
- `/tmp/node26_js_native_api_v8.cc` (lines 2508‑2617)
- `/tmp/node26_js_native_api_v8.h` (lines 191‑243 macros, 132‑143 `CheckGCAccess`)

---

## value reading (primitives)

# N-API Value Reading (Primitives) — Bun vs Node 26

General note on Bun macros (napi.cpp:110-167): `NAPI_PREAMBLE_NO_PENDING_CHECK` = env null-check + JSC throw-scope + VM-exception-only bail (does **not** bail on a stashed `napi_throw*` exception, matching Node's `CHECK_ENV_NOT_IN_GC`). `NAPI_CHECK_ENV_NOT_IN_GC` → `env->checkGC()`. `NAPI_CHECK_ARG` → `napi_invalid_arg`. `NAPI_RETURN_EARLY_IF_FALSE` → sets last error, returns status. `NAPI_RETURN_SUCCESS` → sets last error to `napi_ok`. These map 1:1 onto Node's `CHECK_ENV_NOT_IN_GC` / `CHECK_ARG` / `RETURN_STATUS_IF_FALSE` / `napi_clear_last_error`.

The Rust file (`/workspace/bun/src/runtime/napi/napi_body.rs` lines 806-830, 1080-1084) only contains `extern "C"` declarations; the real implementations are in `/workspace/bun/src/jsc/bindings/napi.cpp`.

---

### `napi_get_value_double` — Bun napi.cpp:2429 / Node js_native_api_v8.cc:2318
OK.
- Minor: Bun checks `result` before `value` (Node checks `value` first). Not observable — both failures return `napi_invalid_arg`.

### `napi_get_value_int32` — Bun napi.cpp:2443 / Node js_native_api_v8.cc:2335
OK.
- Both apply ECMA ToInt32 semantics for non-int32 numbers (Bun via `JSC::toInt32`, Node via `v8::Value::Int32Value`). Same `napi_number_expected` on non-number. Arg-check order swapped (not observable).

### `napi_get_value_uint32` — Bun napi.cpp:2456 / Node js_native_api_v8.cc:2359
OK.
- Both apply ECMA ToUint32 semantics (Bun `JSC::toUInt32`, Node `v8::Value::Uint32Value`). Arg-check order swapped (not observable).

### `napi_get_value_int64` — Bun napi.cpp:2469 / Node js_native_api_v8.cc:2383
OK.
- Non-finite (NaN/±Inf) → `0` in both.
- Out-of-range finite doubles clamp to `INT64_MAX`/`INT64_MIN` in both: Bun does it explicitly (napi.cpp:2482-2488); Node delegates to V8 `IntegerValue` → `NumberToInt64`, which performs the identical clamp. The `>=` / `<=` comparands are the same double value (2⁶³ and -2⁶³) in both.
- In-range: both `static_cast<int64_t>` (truncate toward zero).
- Arg-check order swapped (not observable).

### `napi_get_value_bool` — Bun napi.cpp:2641 / Node js_native_api_v8.cc:2483
OK.
- Identical check order (`value` then `result`), identical `napi_boolean_expected` on non-boolean.

### `napi_get_value_external` — Bun napi.cpp:2919 / Node js_native_api_v8.cc:2801
OK.
- Both return `napi_invalid_arg` (not `napi_object_expected`) when the value is not an external.
- Arg-check order swapped (`result` before `value` in Bun); not observable — same status code.

---

**Summary:** No observable behavioral divergences for any of the six functions. All env/GC/null/type checks, status codes, edge-case numeric conversions, and last-error handling match Node 26. The only textual difference is that Bun null-checks `result` before `value` in five of the six functions (all but `bool`), whereas Node checks `value` first — but since both paths return `napi_invalid_arg` via `napi_set_last_error`, this is not distinguishable by a native addon.

---

## bigint

# N-API BigInt Function Comparison: Bun vs Node.js 26

All six functions are implemented in C++ at `/workspace/bun/src/jsc/bindings/napi.cpp` (Rust side only has `extern "C"` imports in `/workspace/bun/src/runtime/napi/napi_body.rs:1678-1713`).

---

## `napi_create_bigint_int64` (Bun: napi.cpp:3001)
- **Missing "not in GC" check.** Node does `CHECK_ENV_NOT_IN_GC(env)`; Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK(env)` (napi.cpp:3003) which does the env-null check but never calls `env->checkGC()`. For `NAPI_VERSION_EXPERIMENTAL` modules, Node aborts with a fatal error if this is called from a GC finalizer; Bun will silently proceed.

## `napi_create_bigint_uint64` (Bun: napi.cpp:2989)
- **Missing "not in GC" check.** Same as above — `NAPI_PREAMBLE_NO_PENDING_CHECK(env)` at napi.cpp:2991 does not invoke `checkGC()`, whereas Node does `CHECK_ENV_NOT_IN_GC`.

## `napi_create_bigint_words` (Bun: napi.cpp:3013)
- **Missing "not in GC" check.** Node's `NAPI_PREAMBLE` expands to `CHECK_ENV_NOT_IN_GC`; Bun's `NAPI_PREAMBLE_NO_THROW_SCOPE(env)` (napi.cpp:3019) only null-checks `env` and never calls `checkGC()`.
- **Missing `can_call_into_js` check.** Node's `NAPI_PREAMBLE` returns `napi_cannot_run_js` (module API ≥ 10) or `napi_pending_exception` (< 10) when the environment is terminating. Bun has no equivalent here, so during env teardown Bun will attempt the allocation instead of returning `napi_cannot_run_js`.
- **Different status for `INT_MAX < word_count <= UINT_MAX`.** Node: `RETURN_STATUS_IF_FALSE(env, word_count <= INT_MAX, napi_invalid_arg)` → returns `napi_invalid_arg` with no JS exception. Bun at napi.cpp:3027 checks `word_count <= UINT_MAX` for `napi_invalid_arg`, then at napi.cpp:3032 `if (word_count >= INT_MAX)` throws a JS `RangeError: Out of memory` and returns `napi_pending_exception`. So for e.g. `word_count = INT_MAX + 1`, Node gives `napi_invalid_arg` (no throw) but Bun gives `napi_pending_exception` with a pending JS exception.
- **Arg-check order differs** (Bun checks `result` before `words`, Node checks `words` before `result`, napi.cpp:3024-3025) — not observable since both return `napi_invalid_arg`.

## `napi_get_value_bigint_int64` (Bun: napi.cpp:2825)
OK

## `napi_get_value_bigint_uint64` (Bun: napi.cpp:2859)
OK

## `napi_get_value_bigint_words` (Bun: napi.cpp:2882)
OK — validation order, status codes, query-mode (`sign_bit==NULL && words==NULL`), exactly-one-null → `napi_invalid_arg`, and `*word_count` being set to the full bigint word count (not the clamped copy count) all match Node. (Minor non-bug: Node truncates the incoming `*word_count` through `int` before passing to V8; Bun keeps it as `size_t` — Bun is arguably more correct for `*word_count > INT_MAX`.)

---

## symbol & date

# N-API Comparison: Symbol & Date Functions

## napi_create_symbol

Bun impl: `/workspace/bun/src/jsc/bindings/napi.cpp:3052-3081`
Node impl: `/tmp/node26_js_native_api_v8.cc:1925-1944`

- **Different handling of JS `undefined`/`null` description** (napi.cpp:3063): Bun tests `if (descriptionValue && !descriptionValue.isUndefinedOrNull())` — so a non-nullptr `napi_value` holding JS `undefined` or `null` falls through and produces a description-less `Symbol()` with `napi_ok`. Node only special-cases `description == nullptr`; any non-nullptr value that fails `desc->IsString()` (including `undefined`/`null`) returns `napi_string_expected`.
- **Empty-string description dropped** (napi.cpp:3069-3075, `// TODO handle empty string?`): When `description` is the empty string, Bun falls through to `JSC::Symbol::create(vm)` (no description), yielding `symbol.description === undefined`. Node calls `v8::Symbol::New(isolate, desc)` with the empty string, yielding `symbol.description === ""`. Observable via `Symbol.prototype.description`.

## node_api_symbol_for

Bun impl: `/workspace/bun/src/jsc/bindings/napi.cpp:1397-1420`
Node impl: `/tmp/node26_js_native_api_v8.cc:1946-1963`

- **Missing `length > INT_MAX` validation**: Node (via `STATUS_CALL(napi_create_string_utf8(...))` → `CHECK_NEW_STRING_ARGS`) returns `napi_invalid_arg` when `length != NAPI_AUTO_LENGTH && length > INT_MAX`. Bun has no such check and passes the raw `length` to `WTF::String::fromUTF8` (napi.cpp:1416).
- Null-`utf8description` / `length==0` handling and arg-check order otherwise match Node.

## napi_create_date

Bun impl: `/workspace/bun/src/runtime/napi/napi_body.rs:1631-1644`
Node impl: `/tmp/node26_js_native_api_v8.cc:3557-3569`

- **Missing "not in GC" check**: Node uses `NAPI_PREAMBLE` which includes `CHECK_ENV_NOT_IN_GC → env->CheckGCAccess()`. Bun's Rust `preamble!` (napi_body.rs:428-436) only does env-null + pending-exception; there is no `env.check_gc()` call in `napi_create_date`.
- Otherwise equivalent (both check `result != NULL` → `napi_invalid_arg`, both return `napi_pending_exception` if an exception is already pending).

## napi_is_date

Bun impl: `/workspace/bun/src/runtime/napi/napi_body.rs:1647-1662`
Node impl: `/tmp/node26_js_native_api_v8.cc:3571-3581`

OK. (Bun checks `is_date` before `value`, Node checks `value` before `is_date`, but both paths return `napi_invalid_arg` so the status code is identical.)

## napi_get_date_value

Bun impl: `/workspace/bun/src/jsc/bindings/napi.cpp:477-490`
Node impl: `/tmp/node26_js_native_api_v8.cc:3583-3597`

- **Missing "not in GC" check**: Node uses `NAPI_PREAMBLE` (includes `CheckGCAccess()`). Bun's C++ `NAPI_PREAMBLE` (napi.cpp:89-95) does *not* call `checkGC()`; there is no separate `NAPI_CHECK_ENV_NOT_IN_GC` in this function.
- Arg-check order is `result` then `value` (Node: `value` then `result`) — same status (`napi_invalid_arg`), not observably different.
- `napi_date_expected` on non-Date and pending-exception gating match Node.

---

## coercion & type checking

# N-API Comparison: Coercion & Type Checking

General note applying to `napi_coerce_to_*`, `napi_instanceof`, `napi_strict_equals`: Bun's `NAPI_PREAMBLE` (napi.cpp:89) and Rust `preamble!` (napi_body.rs:428) do **not** perform the `CheckGCAccess()` (not-in-GC) check nor the `can_call_into_js()` check (which in Node returns `napi_cannot_run_js` for module_api_version ≥ 10, else `napi_pending_exception`). Node's `NAPI_PREAMBLE` (node26_js_native_api_v8.h:233-243) does both. This is a shared preamble-level difference, not repeated below per function.

---

## napi_typeof
*Bun: /workspace/bun/src/jsc/bindings/napi.cpp:2723 · Node: /tmp/node26_js_native_api_v8.cc:2071*

- **Null env crashes instead of returning `napi_invalid_arg`.** Bun line 2726 `NAPI_CHECK_ENV_NOT_IN_GC(env)` expands to only `(env)->checkGC()` (napi.cpp:125-128) with no prior null check, so a null `env` dereferences null. Node's `CHECK_ENV_NOT_IN_GC` first does `CHECK_ENV` (returns `napi_invalid_arg` on null) before `CheckGCAccess()`. Other Bun call sites pair this macro with `NAPI_PREAMBLE` which null-checks `env`; `napi_typeof` is the only function in this group that uses it standalone.
- **Unknown-type fallback status differs.** Bun line 2817 returns `napi_generic_failure`; Node line 2108 returns `napi_invalid_arg`. (Path should be unreachable, but the status code is observable if ever hit.)

## napi_coerce_to_bool
*Bun: /workspace/bun/src/jsc/bindings/napi.cpp:2212 · Node: /tmp/node26_js_native_api_v8.cc:2619*

OK.

## napi_coerce_to_number
*Bun: /workspace/bun/src/jsc/bindings/napi.cpp:2229 · Node: /tmp/node26_js_native_api_v8.cc:2649 (GEN_COERCE_FUNCTION)*

- **Wrong status when coercion throws.** If `ToNumber` throws (e.g. on a Symbol or a throwing `@@toPrimitive`), Node returns `napi_number_expected` via `CHECK_TO_NUMBER` → `CHECK_MAYBE_EMPTY(..., napi_number_expected)` (node26_js_native_api_v8.cc:18 / .h:245-251). Bun line 2240 `NAPI_RETURN_IF_EXCEPTION(env)` returns `napi_pending_exception` instead.

## napi_coerce_to_object
*Bun: /workspace/bun/src/jsc/bindings/napi.cpp:2246 · Node: /tmp/node26_js_native_api_v8.cc:2650 (GEN_COERCE_FUNCTION)*

- **Wrong status when coercion throws.** If `ToObject` throws (value is `null`/`undefined`), Node returns `napi_object_expected` via `CHECK_TO_OBJECT` → `CHECK_MAYBE_EMPTY(..., napi_object_expected)`. Bun line 2257 `NAPI_RETURN_IF_EXCEPTION(env)` returns `napi_pending_exception` instead.

## napi_coerce_to_string
*Bun: /workspace/bun/src/jsc/bindings/napi.cpp:2191 · Node: /tmp/node26_js_native_api_v8.cc:2651 (GEN_COERCE_FUNCTION)*

- **Wrong status when coercion throws.** If `ToString` throws (e.g. on a Symbol or a throwing `toString`), Node returns `napi_string_expected` via `CHECK_TO_STRING` → `CHECK_MAYBE_EMPTY(..., napi_string_expected)`. Bun line 2205 `NAPI_RETURN_IF_EXCEPTION(env)` returns `napi_pending_exception` instead.

## napi_instanceof
*Bun: /workspace/bun/src/jsc/bindings/napi.cpp:3120 · Node: /tmp/node26_js_native_api_v8.cc:3032*

OK. Arg-check order, `*result = false` initialization, `napi_object_expected` on non-coercible constructor, `ERR_NAPI_CONS_FUNCTION` TypeError + `napi_function_expected` on non-callable, and `napi_generic_failure` on `hasInstance` exception all match. (Minor: Bun writes `*result` at line 3142 before the exception check at 3143, whereas Node checks `IsNothing()` first — but `*result` was already set to `false` and callers shouldn't read it on error, so not meaningfully observable.)

## napi_is_array
*Bun: /workspace/bun/src/runtime/napi/napi_body.rs:946 · Node: /tmp/node26_js_native_api_v8.cc:1530*

OK. Bun checks `result` before `value` (Node checks `value` first), but both paths return `napi_invalid_arg` so the status is identical. `js_type().is_array()` (Array | DerivedArray, JSType.rs:750) matches V8's `IsArray()` (direct type check, not `Array.isArray` proxy-unwrapping).

## napi_strict_equals
*Bun: /workspace/bun/src/runtime/napi/napi_body.rs:989 · Node: /tmp/node26_js_native_api_v8.cc:1559*

OK. Bun checks `result` before `lhs`/`rhs` (Node checks `lhs`, `rhs`, `result`), but all failures yield `napi_invalid_arg` so not observable.

---

## object properties (get/set/has/delete)

# N-API Property Functions: Bun vs Node 26

**General difference applying to all functions below (noted once):** Node's `NAPI_PREAMBLE` (node26_js_native_api_v8.h:233) does `CHECK_ENV_NOT_IN_GC` (calls `CheckGCAccess()`) and checks `can_call_into_js()` (returning `napi_cannot_run_js` for api_version ≥ 10 or `napi_pending_exception` otherwise). Bun's `NAPI_PREAMBLE` (napi.cpp:89) does **neither** — it only checks env-null and pending exception. So every function below that uses `NAPI_PREAMBLE` in Bun is missing the not-in-GC check and the `can_call_into_js` check that Node has.

---

### napi_get_property_names
OK (Bun napi.cpp:2263 re-implements rather than delegating to `napi_get_all_property_names`, but validation order/status codes are equivalent; extra redundant `NAPI_CHECK_ARG(env, object)` at :2267 is harmless).

### napi_get_all_property_names
OK (Bun napi.cpp:2034 — arg-check order identical; extra redundant `NAPI_CHECK_ARG(env, objectNapi)` at :2041 before `NAPI_CHECK_TO_OBJECT` is harmless; `key_mode`/`key_conversion` validated after object coercion, matching Node).

### napi_set_property
- **Set-failure status lost** (napi.cpp:415): Bun discards the `putInline` return value (`(void)object->putInline(...)`). Node (node26:1171) returns `napi_generic_failure` when `Set()` returns `false` without throwing (e.g. Proxy `set` trap returns false, or non-writable property in sloppy mode). Bun returns `napi_ok` in that case.
- Arg-check order differs (Bun checks `target` before `key`/`value`; Node checks `key`→`value`→`object`) but all paths return `napi_invalid_arg`, so not observably different.

### napi_get_property
- Arg-check order differs (Bun napi.cpp:496-498 checks `object`→`key`→`result`; Node node26:1203-1210 checks `key`→`result`→`object`). Same status code either way; not observably different.
- Otherwise OK.

### napi_has_property
- Arg-check order differs (Bun napi.cpp:460-462 `object`→`result`→`key`; Node node26:1181-1187 `result`→`key`→`object`). Same status code; not observably different.
- Otherwise OK.

### napi_delete_property
OK (Bun napi.cpp:529; arg-check order differs — Bun `object`→`key` vs Node `key`→`object` — but same `napi_invalid_arg` either way; `result` optional in both).

### napi_has_own_property
OK (Bun napi.cpp:555; arg-check order differs — Bun `object`→`key`→`result` vs Node `key`→`result`→`object` — but same status; `napi_name_expected` check on key matches).

### napi_set_named_property
- **Empty-string name rejected** (napi.cpp:602): `NAPI_RETURN_EARLY_IF_FALSE(env, *utf8name, napi_invalid_arg)` — Bun returns `napi_invalid_arg` when `utf8name` is `""`. Node (`CHECK_NEW_FROM_UTF8`, node26:40) does **not** reject empty strings; it sets a property with key `""` and returns `napi_ok`.
- **Set-failure status lost** (napi.cpp:616): Bun does not check `putInline` return value. Node (node26:1281) returns `napi_generic_failure` if `Set()` returns `false` without throwing.
- Arg-check order differs (Bun `object`→`utf8name`→`value`; Node `value`→`object`→`utf8name`). Same status code.

### napi_get_named_property
- **Out-param written on exception** (napi.cpp:707): `*result = toNapi(target->get(...), globalObject)` is assigned before `NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION`. If a getter/Proxy throws, Bun writes `*result` (possibly an empty/garbage handle) then returns `napi_pending_exception`. Node (node26:1327) checks `CHECK_MAYBE_EMPTY_WITH_PREAMBLE` **before** writing `*result`.
- Arg-check order differs (Bun napi.cpp:696-698 `object`→`utf8Name`→`result`; Node node26:1314-1323 `result`→`utf8name`→`object`). Same status code.

### napi_has_named_property
- **Out-param written on exception** (napi.cpp:688): `*result = target->getPropertySlot(...)` is assigned before the exception check. Node (node26:1303-1305) bails on exception before writing `*result`.
- Arg-check order differs (Bun `object`→`utf8Name`→`result`; Node `result`→`object`→`utf8name`). Same status code.

### napi_set_element
- **Set-failure status lost** (napi.cpp:433): `(void)jsObject->putByIndexInline(...)` — return value discarded. Node (node26:1349) returns `napi_generic_failure` when `Set()` returns `false` without throwing.
- Arg-check order differs (Bun `object`→`value`; Node `value`→`object`). Same status code.

### napi_get_element
OK (Bun napi.cpp:2654; arg checks match Node's order `result`→`object`).

### napi_has_element
OK (Bun napi.cpp:437; arg-check order differs — Bun `object`→`result` vs Node `result`→`object` — but same status code).

### napi_delete_element
OK (Bun napi.cpp:2671; validation matches; `result` optional in both).

### napi_define_properties
- **No ToObject coercion on `object`** (napi.cpp:1006-1007): Bun uses `objectValue.getObject()` and returns `napi_object_expected` for any non-object (primitives like number/string/bool). Node (node26:1426) uses `CHECK_TO_OBJECT` which **coerces** primitives via `ToObject()` and only fails (`napi_object_expected`) for JS `null`/`undefined`. Observable: `napi_define_properties(env, <number 42>, …)` → Node returns `napi_ok`, Bun returns `napi_object_expected`.
- Arg-check order differs (Bun napi.cpp:1002-1003 checks `object` before `properties`; Node node26:1419-1426 checks `properties` before `object`). Same `napi_invalid_arg`; not observably different.
- Bun returns `napi_name_expected` when both `p->utf8name` and `p->name` are NULL (napi.cpp:337-338); Node would dereference an empty `Local` (undefined behavior/crash). Bun is more defensive — not a compat bug.

### node_api_create_object_with_properties
- **Extra pending-exception check** (napi.cpp:1649): Bun uses `NAPI_PREAMBLE(env)`, which returns `napi_pending_exception` if an exception is already pending. Node (node26:1628) uses only `CHECK_ENV_NOT_IN_GC` — it does **not** check pending exception, so it proceeds and returns `napi_ok` even with a pending exception.
- **Extra prototype validation** (napi.cpp:1666): Bun returns `napi_invalid_arg` if `prototype_or_null` is a non-null, non-object JS value (e.g. a number or string). Node (node26:1636-1641) does no such validation and passes the value straight to `v8::Object::New`. Bun is stricter.

---

**Files referenced:**
- /workspace/bun/src/jsc/bindings/napi.cpp
- /workspace/bun/src/jsc/bindings/napi.h
- /tmp/node26_js_native_api_v8.cc
- /tmp/node26_js_native_api_v8.h

---

## object freeze/seal/prototype

# N-API Comparison Report: object freeze/seal/prototype

**General note (applies to all 5 functions):** Node's `NAPI_PREAMBLE` (node26_js_native_api_v8.h:233-243) performs three checks Bun's preambles omit or partially omit:
- `CheckGCAccess()` — Bun's C++ `NAPI_PREAMBLE` (napi.cpp:89) and Rust `preamble!` (napi_body.rs:428) do **not** call `checkGC()`; it must be added explicitly per‑function.
- `can_call_into_js()` → `napi_cannot_run_js` (api ≥ 10) / `napi_pending_exception` — neither Bun preamble has an equivalent.

---

### `napi_object_freeze` (Bun: napi.cpp:1797-1811)
- **Missing in‑GC check.** Node runs `CHECK_ENV_NOT_IN_GC` via `NAPI_PREAMBLE`; Bun's `NAPI_PREAMBLE` does not, and no explicit `NAPI_CHECK_ENV_NOT_IN_GC` is present.
- **Primitive coercion.** Node uses `CHECK_TO_OBJECT` → `ToObject()`: primitives (number/string/bool/symbol) are boxed and the call succeeds with `napi_ok`. Bun tests `value.isObject()` (napi.cpp:1802) and returns `napi_object_expected` for any primitive.
- **null/undefined input.** Node's `ToObject()` throws a `TypeError` (captured into `env->last_exception` by `TryCatch`) and returns `napi_object_expected`; Bun returns `napi_object_expected` **without** throwing/pending an exception.

### `napi_object_seal` (Bun: napi.cpp:1812-1826)
- Same three differences as `napi_object_freeze` (identical structure, same line-level issues at napi.cpp:1814/1817).

### `napi_get_prototype` (Bun: napi_body.rs:878-901)
- **Missing in‑GC check.** `preamble!` at napi_body.rs:884 does not call `env.check_gc()`.
- **Proxy trap invocation.** Node calls `obj->GetPrototypeV2()` which per its comment "doesn't invoke Proxy's [[GetPrototypeOf]] handler". Bun calls `JSValue::getPrototype` (bindings.cpp:3816 → JSC `JSObject::getPrototype`), which dispatches through the method table and **does** invoke `ProxyObject::getPrototype`. Observable for Proxies with a `getPrototypeOf` trap.
- **No exception check after `get_prototype`.** If the Proxy trap (above) throws, Bun still executes `env.ok()` (napi_body.rs:900) and returns `napi_ok` with a VM exception pending; Node would return `napi_pending_exception` via `GET_RETURN_STATUS` (though Node never reaches the trap anyway).

### `node_api_set_prototype` (Bun: napi.cpp:1617-1640)
- **Primitive `object` arg.** Node uses `CHECK_TO_OBJECT` (ToObject coercion) so a primitive `object` is boxed and the set proceeds (returning `napi_ok`, albeit uselessly). Bun tests `toJS(object).getObject()` (napi.cpp:1628) and returns `napi_object_expected` for primitives.
- **null/undefined `object` arg.** Node throws a `TypeError` (stashed in `last_exception`) and returns `napi_object_expected`; Bun returns `napi_object_expected` with no exception thrown.
- **Non‑object / non‑null `value` (prototype) arg.** Bun returns `napi_invalid_arg` (napi.cpp:1634). Node passes the value straight to `obj->SetPrototypeV2(context, val)`; V8 rejects it and Node returns `napi_generic_failure` (or `napi_pending_exception` if V8 threw) — different status code.
- In‑GC check: OK (explicit `NAPI_CHECK_ENV_NOT_IN_GC` at napi.cpp:1621).

### `napi_get_array_length` (Bun: napi_body.rs:964-986)
- **Missing in‑GC check.** `preamble!` at napi_body.rs:970 does not call `env.check_gc()` (contrast with adjacent `napi_is_array` which does, napi_body.rs:955).
- **Arg‑check order swapped.** Node checks `value` then `result`; Bun checks `result` (via `get_out!` napi_body.rs:971) then `value` (napi_body.rs:973). Both paths return `napi_invalid_arg`, so not externally observable.
- Otherwise OK (both return `napi_array_expected` for non‑arrays; both write `uint32_t` length).

---

**Files referenced:**
- /workspace/bun/src/jsc/bindings/napi.cpp (lines 89-173, 1617-1640, 1797-1826)
- /workspace/bun/src/runtime/napi/napi_body.rs (lines 415-446, 878-901, 964-986)
- /workspace/bun/src/jsc/bindings/bindings.cpp (line 3816)
- /workspace/bun/vendor/WebKit/Source/JavaScriptCore/runtime/JSObjectInlines.h (lines 60-65, 83-88)
- /tmp/node26_js_native_api_v8.cc (lines 1496-1610)
- /tmp/node26_js_native_api_v8.h (lines 191-282)

---

## functions & classes

# N-API Comparison: Functions & Classes

**Cross-cutting `NAPI_PREAMBLE` differences** (Bun `napi.cpp:89-95` vs Node `js_native_api_v8.h:233-243`), applies to `napi_create_function`, `napi_call_function`, `napi_new_instance`, `napi_define_class`:
- Bun's `NAPI_PREAMBLE` does **not** call `checkGC()`; Node's does `CHECK_ENV_NOT_IN_GC`. So Bun does not abort (under `NAPI_VERSION_EXPERIMENTAL`) when these are called from a GC finalizer; Node does.
- Bun's `NAPI_PREAMBLE` does **not** check `can_call_into_js()`; Node returns `napi_cannot_run_js` (module_api_version ≥ 10) or `napi_pending_exception` (< 10) when the env is shutting down. Bun will proceed to run JS.

---

## napi_create_function
- **Missing length validation** (Bun `napi.cpp:962-964`): Node's `CHECK_NEW_FROM_UTF8_LEN` (node26 `js_native_api_v8.cc:29-30`) returns `napi_invalid_arg` when `length != NAPI_AUTO_LENGTH && length > INT_MAX`. Bun passes `length` straight to `WTF::String::fromUTF8` with no bound check, so a caller passing an over-large `length` gets no `napi_invalid_arg` (and may over-read).
- Cross-cutting `NAPI_PREAMBLE` gaps noted above.
- Otherwise arg-check order (`result`, then `cb`) and status codes match.

## napi_call_function
- **Null-env crash** (Bun `napi.cpp:3153`): `env->throwPendingException()` is called **before** the `NAPI_PREAMBLE(env)` null-check at line 3157. Passing `env == nullptr` segfaults; Node returns `napi_invalid_arg`.
- **Pending exception is thrown into VM instead of left stashed**: Bun line 3153 calls `throwPendingException()` which moves `m_pendingException` into the VM throw scope and clears the stash, then returns `napi_pending_exception`. Node's `NAPI_PREAMBLE` returns `napi_pending_exception` while leaving `env->last_exception` untouched. Observable to addons that subsequently call `napi_get_and_clear_last_exception` / `napi_is_exception_pending` and rely on the stash vs. VM distinction.
- Cross-cutting `NAPI_PREAMBLE` gaps noted above.
- Arg-check order (`recv` → `argv` when `argc>0` → `func` non-null → func-is-callable→`napi_invalid_arg`) matches Node's `CHECK_TO_FUNCTION`.

## napi_new_instance
- **`*result` is written even when the constructor throws** (Bun `napi.cpp:3114-3117`): Bun does `*result = toNapi(value, ...)` unconditionally before checking for exceptions; Node returns early via `CHECK_MAYBE_EMPTY(..., napi_pending_exception)` at `js_native_api_v8.cc:3026` **before** writing `*result`. An addon that inspects `*result` after a failed call sees different contents.
- Cross-cutting `NAPI_PREAMBLE` gaps noted above.
- Arg validation order (`constructor` → `argv` if `argc>0` → `result` → is-function→`napi_invalid_arg`) and status codes match.

## napi_get_new_target
- Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:1852), which returns `napi_pending_exception` if a **VM** exception is already pending. Node uses only `CHECK_ENV_NOT_IN_GC` (no exception check at all, `js_native_api_v8.cc:2167`) and always succeeds. Minor, but observable if called with a VM exception already pending.
- Otherwise OK: both check `cbinfo` then `result`, both return a `nullptr` `napi_value` when not a construct call (Bun via `toNapi(JSValue())` which encodes to 0), both clear last_error.

## napi_get_cb_info
- **Missing `argc` null-check when `argv` is non-null** (Bun `napi.cpp:300-324` `NAPICallFrame::extract`): Node does `if (argv != nullptr) { CHECK_ARG(env, argc); ... }` (`js_native_api_v8.cc:2147-2150`) and returns `napi_invalid_arg` when `argv != NULL && argc == NULL`. Bun silently treats this as `maxArgc = 0`, writes nothing into `argv`, and returns `napi_ok`.
- Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:983) which returns `napi_pending_exception` if a VM exception is already set; Node uses plain `CHECK_ENV` (no exception or GC check, `js_native_api_v8.cc:2141`). Minor.
- Arg-fill semantics (extra slots padded with `undefined`) match.

## napi_define_class
- **Arg-check order differs** (Bun `napi.cpp:2163-2166` vs Node `js_native_api_v8.cc:980-995`): Node checks `result` → `constructor` → `properties` (if count>0) → then `utf8name` (inside `CHECK_NEW_FROM_UTF8_LEN`). Bun checks `result` → `utf8name` → `constructor` → `properties`. Since every failing branch returns `napi_invalid_arg`, the returned status is identical — not addon-observable.
- **Missing length validation** (Bun `napi.cpp:2170-2174`): same issue as `napi_create_function` — Node returns `napi_invalid_arg` when `length != NAPI_AUTO_LENGTH && length > INT_MAX` (via `CHECK_NEW_FROM_UTF8_LEN` at `js_native_api_v8.cc:995`); Bun has no such guard.
- Cross-cutting `NAPI_PREAMBLE` gaps noted above.
- Both require `utf8name != NULL` (Node via `CHECK_NEW_FROM_UTF8_LEN` line 31, Bun via explicit `NAPI_CHECK_ARG`), both require `properties != NULL` only when `property_count > 0`, both return `napi_invalid_arg` for all validation failures.

---

**Files referenced:**
- `/workspace/bun/src/jsc/bindings/napi.cpp`
- `/workspace/bun/src/jsc/bindings/napi.h`
- `/tmp/node26_js_native_api_v8.cc`
- `/tmp/node26_js_native_api_v8.h`

---

## wrap & external & type tag

# N-API Comparison: wrap & external & type tag

**Note on all 6 functions (preamble differences):** Bun's `NAPI_PREAMBLE` macro (napi.cpp:89–95) differs from Node's (node26_js_native_api_v8.h:233–243) in two systemic ways that affect every function below:
- Bun's `NAPI_PREAMBLE` does **not** call `env->checkGC()`; Node's calls `CheckGCAccess()` (fatal-abort if in a GC finalizer under `NAPI_VERSION_EXPERIMENTAL`). Bun has `checkGC()` (napi.h:394) but `NAPI_PREAMBLE` never invokes it.
- Bun's `NAPI_PREAMBLE` does **not** check `can_call_into_js()`; Node returns `napi_cannot_run_js` (api ≥ 10) or `napi_pending_exception` (api < 10) when the env is shutting down.

---

### napi_wrap
(Bun: napi.cpp:838–891; Node: v8impl::Wrap @ node26_js_native_api_v8.cc:525–586)

- **Wrong status for non-object `js_object`**: Bun line 857 returns `napi_object_expected`; Node line 537 returns `napi_invalid_arg`.
- **Missing `finalize_cb` null-check when `result != nullptr`**: Node line 552 does `CHECK_ARG(env, finalize_cb)` → `napi_invalid_arg` if `result` is non-null but `finalize_cb` is null. Bun has no such check (lines 883–888 accept `result != nullptr` with `finalize_cb == nullptr`).
- Preamble differences (see note above).

---

### napi_unwrap
(Bun: napi.cpp:929–948; Node: v8impl::Unwrap(KeepWrap) @ node26_js_native_api_v8.cc:339–377)

- **Wrong status for non-object `js_object`**: Bun line 938 returns `napi_object_expected`; Node line 352 returns `napi_invalid_arg`.
- Preamble differences (see note above).

Otherwise OK (both check `result != nullptr`, both return `napi_invalid_arg` when not wrapped).

---

### napi_remove_wrap
(Bun: napi.cpp:893–927; Node: v8impl::Unwrap(RemoveWrap) @ node26_js_native_api_v8.cc:339–377)

- **Wrong status for non-object `js_object`**: Bun line 901 returns `napi_object_expected`; Node line 352 returns `napi_invalid_arg`.
- **Runtime-owned ref not freed immediately**: Node lines 368–373 `delete reference` immediately when ownership is `kRuntime` (i.e. `napi_wrap` was called with `result == nullptr`). Bun line 921 only clears the finalizer and relies on GC of the JS object to eventually free the `NapiRef`. Observable as delayed native memory release, not as a status-code difference.
- Preamble differences (see note above).

---

### napi_create_external
(Bun: napi.cpp:2705–2721; Node: node26_js_native_api_v8.cc:2679–2708)

- Preamble differences (see note above).

Otherwise OK (same arg validation: env, then `result != nullptr`).

---

### napi_type_tag_object
(Bun: napi.cpp:3197–3215; Node: node26_js_native_api_v8.cc:2710–2747)

- **Arg-check order differs**: Bun checks `type_tag != nullptr` (line 3201) *before* the object check; Node checks `type_tag` (line 2729) *after* `CHECK_TO_OBJECT_WITH_PREAMBLE`. Observable when both `value` is a non-object and `type_tag` is null — Bun returns `napi_invalid_arg`, Node returns `napi_object_expected`/`napi_pending_exception`.
- **Primitive coercion**: Node uses `ToObject()` (line 2728 via `CHECK_TO_OBJECT_WITH_PREAMBLE`), which **coerces** numeric/string/boolean primitives into wrapper objects and returns `napi_ok`. Bun line 3203 uses `getObject()`, which returns nullptr for primitives → `napi_object_expected`. Example: `napi_type_tag_object(env, <number 5>, tag)` → Node `napi_ok`, Bun `napi_object_expected`.
- **null/undefined value**: Node's `ToObject()` throws a `TypeError`, which the try-catch captures → returns `napi_pending_exception` **and leaves a pending exception on the env**. Bun line 3204 returns `napi_object_expected` with **no** pending exception.
- Preamble differences (see note above).

Both correctly return `napi_invalid_arg` when already tagged; both support tagging externals (Bun via the normal object path since `NapiExternal` is a `JSObject`).

---

### napi_check_object_type_tag
(Bun: napi.cpp:3217–3235; Node: node26_js_native_api_v8.cc:2749–2799)

- **Missing `result != nullptr` check**: Node line 2769 does `CHECK_ARG_WITH_PREAMBLE(env, result)` → `napi_invalid_arg` if `result` is null (on the non-external path). Bun line 3231 does `if (result) [[likely]]` and silently returns `napi_ok` when `result` is null.
- **Arg-check order differs**: Bun checks `type_tag != nullptr` (line 3221) before the object check; Node checks it after (line 2768). Same observable consequence as in `napi_type_tag_object`.
- **Primitive coercion**: same as `napi_type_tag_object` — Node's `CHECK_TO_OBJECT_WITH_PREAMBLE` (line 2767) coerces primitives and returns `napi_ok` (with `*result = false`); Bun line 3224 returns `napi_object_expected`.
- **null/undefined value**: same as `napi_type_tag_object` — Node returns `napi_pending_exception` with a pending `TypeError`; Bun returns `napi_object_expected` with no exception.
- Preamble differences (see note above).

---

**Relevant files:**
- /workspace/bun/src/jsc/bindings/napi.cpp (lines 89–173 macros; 838–948 wrap/unwrap/remove_wrap; 2705–2721 create_external; 3197–3235 type_tag)
- /workspace/bun/src/jsc/bindings/napi.h (lines 389–408 `inGC`/`checkGC`)
- /tmp/node26_js_native_api_v8.cc (lines 339–377 Unwrap; 525–586 Wrap; 837–884 ExternalWrapper; 2655–2799)
- /tmp/node26_js_native_api_v8.h (lines 191–299 macros)

---

## arraybuffer & typedarray

# N-API ArrayBuffer & TypedArray: Bun vs Node.js 26

## napi_create_arraybuffer
OK (Bun `napi.cpp:620`). Functionally equivalent — preamble + GC check + result check; `napi_generic_failure` on allocation failure is an acceptable extra, not a divergence.

---

## napi_create_external_arraybuffer
- **Missing not-in-GC check** (Bun `napi.cpp:2388`): Bun's `NAPI_PREAMBLE` does not include a GC check. Node's `NAPI_PREAMBLE` includes `CHECK_ENV_NOT_IN_GC` (via `napi_create_external_buffer`). Observable only for `NAPI_VERSION_EXPERIMENTAL` addons calling from a finalizer.

---

## napi_get_arraybuffer_info
OK (Bun `napi_body.rs:1390`). Accepts both `ArrayBuffer` and `SharedArrayBuffer` (JSC stores both under `JSType::ArrayBuffer`, and Bun does not gate on `!shared`), matching Node 26's new `IsSharedArrayBuffer()` branch at `node26_js_native_api_v8.cc:3204`.

---

## napi_is_arraybuffer
OK (Bun `napi_body.rs:1346`). `result`/`value` null checks are in swapped order vs Node but both return `napi_invalid_arg`, so not observable. Correctly excludes `SharedArrayBuffer`.

---

## napi_detach_arraybuffer
OK (Bun `napi.cpp:1278`). Matches Node's status codes (`napi_arraybuffer_expected` → `napi_detachable_arraybuffer_expected` → ok). Bun short-circuits an already-detached buffer to `napi_ok`; in V8 an already-detached buffer is still `IsDetachable()==true` and `Detach()` is a no-op, so Node also returns `napi_ok` — equivalent.

---

## napi_is_detached_arraybuffer
OK (Bun `napi.cpp:1262`). Matches Node exactly (writes `false` for non-ArrayBuffer / SharedArrayBuffer, never returns an error status).

---

## napi_create_typedarray
- **Wrong status for non-ArrayBuffer input** (Bun `napi.cpp:1975`): Bun returns `napi_arraybuffer_expected`; Node returns `napi_invalid_arg` (`node26_js_native_api_v8.cc:3344`).
- **Missing `ERR_NAPI_INVALID_TYPEDARRAY_ALIGNMENT` / `ERR_NAPI_INVALID_TYPEDARRAY_LENGTH` RangeErrors and wrong status** (Bun `napi.cpp:1997-1998`): Node validates `byte_offset % elem_size == 0` and `length*elem_size + byte_offset <= buffer.byteLength()` and on failure throws a `RangeError` with those specific `.code`s and returns **`napi_generic_failure`** (`node26_js_native_api_v8.cc:54-71`, via `THROW_RANGE_ERROR_IF_FALSE` → `napi_set_last_error(env, napi_generic_failure)`). Bun defers to JSC `JS*Array::create()` which throws a generic `RangeError` without a `.code`, and `NAPI_RETURN_IF_EXCEPTION` then returns **`napi_pending_exception`**.
- **Missing not-in-GC check** (Bun `napi.cpp:1969`): Bun's `NAPI_PREAMBLE` lacks the GC check that Node's includes.

---

## napi_get_typedarray_info
- **Does not reject non-TypedArray when `type` out-param is NULL** (Bun `napi_body.rs:1443-1451`): Node unconditionally does `RETURN_STATUS_IF_FALSE(env, value->IsTypedArray(), napi_invalid_arg)` at `node26_js_native_api_v8.cc:3359`. Bun only rejects unmapped JSTypes inside `if let Some(ty) = maybe_type.as_mut()`. So if the caller passes `type = NULL` and `typedarray` is a `DataView` or an `ArrayBuffer`, Bun returns `napi_ok` and writes the other out-params (for `ArrayBuffer` input, the `arraybuffer` out-param becomes an empty `JSValue` since `get_array_buffer_view_buffer` returns `ZERO`); Node returns `napi_invalid_arg`.

---

## napi_is_typedarray
- **Missing not-in-GC check** (Bun `napi.cpp:662`): uses `NAPI_PREAMBLE_NO_PENDING_CHECK`, which has no `NAPI_CHECK_ENV_NOT_IN_GC`. Node uses `CHECK_ENV_NOT_IN_GC`. Observable only for `NAPI_VERSION_EXPERIMENTAL` in a finalizer.

---

## napi_create_dataview
- **Wrong status for non-ArrayBuffer input** (Bun `napi.cpp:1879`): Bun returns `napi_arraybuffer_expected`; Node returns `napi_invalid_arg` (`node26_js_native_api_v8.cc:3449`).
- **Missing not-in-GC check** (Bun `napi.cpp:1871`): `NAPI_PREAMBLE_NO_THROW_SCOPE` + manual throw-scope has no GC check; Node's `NAPI_PREAMBLE` includes `CHECK_ENV_NOT_IN_GC`.
- The `ERR_NAPI_INVALID_DATAVIEW_ARGS` RangeError + `napi_pending_exception` path at `napi.cpp:1881-1884` matches Node.

---

## napi_get_dataview_info
- **Wrong status for non-object input** (Bun `napi_body.rs:1514`): when `as_array_buffer()` fails (e.g. a number, string), Bun returns `napi_object_expected`. Node returns `napi_invalid_arg` (`node26_js_native_api_v8.cc:3476`).
- **Does not reject non-DataView** (Bun `napi_body.rs:1513-1516`): Node does `RETURN_STATUS_IF_FALSE(env, value->IsDataView(), napi_invalid_arg)`. Bun accepts any value for which `as_array_buffer()` succeeds — a `Uint8Array`, other `TypedArray`, or even a plain `ArrayBuffer` will return `napi_ok` and fill the out-params. Node returns `napi_invalid_arg` for those.

---

## napi_is_dataview
- **Missing not-in-GC check** (Bun `napi_body.rs:1486-1487`): no `env.check_gc()` call between `get_env!` and `get_out!`. Node uses `CHECK_ENV_NOT_IN_GC` (`node26_js_native_api_v8.cc:3456`). All other `napi_is_*` in this group do call it; this one was missed.

---

### Relevant file paths
- `/workspace/bun/src/runtime/napi/napi_body.rs`
- `/workspace/bun/src/jsc/bindings/napi.cpp`
- `/workspace/bun/src/jsc/bindings/napi.h`
- `/workspace/bun/src/jsc/bindings/bindings.cpp` (for `JSC__JSValue__asArrayBuffer`)
- `/tmp/node26_js_native_api_v8.cc`
- `/tmp/node26_js_native_api_v8.h`

---

## buffer

# N-API Buffer Functions: Bun vs Node.js 26

## General note (applies to every function below)

Bun's `NAPI_PREAMBLE` / `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:89-114) and Rust `preamble!` / `get_env!` (napi_body.rs:415-436) do **not** invoke `checkGC()`. Node's `NAPI_PREAMBLE` and `CHECK_ENV_NOT_IN_GC` both call `CheckGCAccess()` (node26_js_native_api_v8.h:213-217, 233). None of the six buffer functions in Bun add an explicit `NAPI_CHECK_ENV_NOT_IN_GC`, so the "fatal error when called from a GC finalizer under NAPI_VERSION_EXPERIMENTAL" behaviour is missing for all six.

---

### napi_create_buffer
`/workspace/bun/src/jsc/bindings/napi.cpp:2282-2305` vs `/tmp/node26_node_api.cc:1055-1075`

- Missing not-in-GC check (see general note).
- On allocation failure, Bun returns `napi_pending_exception` (via `NAPI_RETURN_IF_EXCEPTION`, line 2294). Node returns `napi_generic_failure` (via `CHECK_MAYBE_EMPTY`, node_api.cc:1064).
- When `length == 0`, Bun writes `*data = nullptr` (line 2300). Node writes whatever `node::Buffer::Data(buffer)` returns (node_api.cc:1071), which can be a non-null sentinel pointer. Addons that test `if (data != NULL)` can observe this.

---

### napi_create_buffer_copy
`/workspace/bun/src/runtime/napi/napi_body.rs:2024-2057` vs `/tmp/node26_node_api.cc:1116-1137`

- Missing not-in-GC check (Rust `preamble!` does not call `check_gc()`).
- On allocation failure, Bun returns `napi_pending_exception` (line 2036). Node returns `napi_generic_failure` (`CHECK_MAYBE_EMPTY`, node_api.cc:1127).
- When `length == 0`, Bun writes `*result_data = nullptr` (lines 2046-2049). Node writes `node::Buffer::Data(buffer)` (node_api.cc:1133), which may be non-null.

---

### napi_create_external_buffer
`/workspace/bun/src/jsc/bindings/napi.cpp:2337-2383` vs `/tmp/node26_node_api.cc:1077-1114`

- Missing not-in-GC check.
- **Semantic difference for empty/null input** (lines 2350-2365): when `data == nullptr || length == 0`, Bun creates a zero-length `Uint8Array` and then **detaches** its backing `ArrayBuffer` (`buffer->existingBuffer()->detach(vm)`, line 2356). Node passes the pointer/length straight to `node::Buffer::New(...)`, which produces an **attached** zero-length buffer (and for `data != nullptr, length == 0` still wraps the user's pointer, not a new allocation). An addon inspecting `buf.buffer.detached` / `buf.buffer.byteLength` will see different results.
- On creation failure, Bun returns `napi_pending_exception` (line 2375). Node returns `napi_generic_failure` (`CHECK_MAYBE_EMPTY`, node_api.cc:1105).

---

### napi_get_buffer_info
`/workspace/bun/src/runtime/napi/napi_body.rs:2064-2081` vs `/tmp/node26_node_api.cc:1150-1169`

- Missing not-in-GC check (`get_env!` does not call `check_gc()`).
- **Accepts plain `ArrayBuffer`**: Bun's type check is `value.as_array_buffer(...)` (line 2073), which delegates to `JSC__JSValue__asArrayBuffer` (bindings.cpp:3070). That function returns `true` for `ArrayBufferType` (bindings.cpp:3107-3116) as well as TypedArray/DataView. Node uses `node::Buffer::HasInstance` → `val->IsArrayBufferView()`, which is **false** for a bare `ArrayBuffer`, so Node returns `napi_invalid_arg` where Bun returns `napi_ok` and fills `data`/`length`.
- Bun has no explicit `CHECK_ARG(env, value)`; a null `value` falls through `as_array_buffer` (bindings.cpp:3077 `!value.isCell()`) and still yields `napi_invalid_arg`, so the observable status matches Node.

---

### napi_is_buffer
`/workspace/bun/src/jsc/bindings/napi.cpp:647-658` vs `/tmp/node26_node_api.cc:1139-1148`

- Missing not-in-GC check.
- Otherwise OK — `isTypedArrayTypeIncludingDataView` matches Node's `HasInstance` (`IsArrayBufferView()`), and null checks / status codes align.

---

### node_api_create_buffer_from_arraybuffer
`/workspace/bun/src/jsc/bindings/napi.cpp:1573-1606` vs `/tmp/node26_node_api.cc:1468-1497`

- Missing not-in-GC check.
- **Wrong status when `arraybuffer` is not an ArrayBuffer**: Bun returns `napi_arraybuffer_expected` (line 1588). Node returns `napi_invalid_arg` (node_api.cc:1481).
- **Accepts `SharedArrayBuffer`**: Bun's check is `dynamicDowncast<JSC::JSArrayBuffer>` (line 1587), which succeeds for JSC `SharedArrayBuffer` (same cell class). Node's check is `arraybuffer_value->IsArrayBuffer()`, which is `false` for `SharedArrayBuffer`, so Node rejects it with `napi_invalid_arg` where Bun proceeds.
- **Different status on out-of-range**: when `byte_offset + byte_length > byteLength`, Bun throws the `RangeError` and returns `napi_pending_exception` (line 1596). Node calls `return napi_throw_range_error(...)` (node_api.cc:1487-1488); `napi_throw_range_error` returns `napi_ok` (js_native_api_v8.cc:2282), so Node returns **`napi_ok`** with a pending exception. Both throw the same `RangeError("ERR_OUT_OF_RANGE", "The byte offset + length is out of range")`, but the returned status differs.
- `last_error` on non-ArrayBuffer: Node does a bare `return napi_invalid_arg;` (node_api.cc:1481) **without** `napi_set_last_error`, so `napi_get_last_error_info` afterwards reports `napi_ok` (it was cleared in `NAPI_PREAMBLE`). Bun calls `napi_set_last_error(env, napi_arraybuffer_expected)`. Observable via `napi_get_last_error_info`.

---

## sharedarraybuffer (new)

## SharedArrayBuffer N-API function comparison

### `node_api_is_sharedarraybuffer`
**OK** — Bun (napi.cpp:1687-1699) matches Node: env-null → not-in-GC → `value` null → `result` null → write bool → clear last error. No pending-exception check in either (correct, this is a type-check function).

---

### `node_api_create_sharedarraybuffer`
Bun impl: `/workspace/bun/src/jsc/bindings/napi.cpp:1701-1725`

- **Check ordering (minor):** Node's `NAPI_PREAMBLE` does env-null → not-in-GC → pending-exception. Bun does env-null → pending-exception (inside `NAPI_PREAMBLE` at :89-95) → not-in-GC (separate `NAPI_CHECK_ENV_NOT_IN_GC` at :1706). Observable only if called from a GC finalizer (experimental module version) *while* an exception is pending: Node aborts, Bun returns `napi_pending_exception`. Very narrow edge case.
- **Allocation failure:** Bun returns `napi_generic_failure` when `ArrayBuffer::tryCreate` fails (line 1713). Node calls `v8::SharedArrayBuffer::New(isolate, byte_length)` which fatally aborts on OOM — it has no graceful-failure path. Bun is more graceful; different but not a compatibility bug.
- **`can_call_into_js` check:** Node's `NAPI_PREAMBLE` returns `napi_cannot_run_js` (module_api_version ≥ 10) / `napi_pending_exception` when the env is terminating. Bun's `NAPI_PREAMBLE` has no equivalent check. (Systemic across Bun's NAPI_PREAMBLE, not specific to this function.)
- **`*data` write guard:** Bun line 1721 guards on `data && jsArrayBuffer->impl()`; Node writes `*data` whenever `data != nullptr`. In practice `impl()` is never null after a successful create, so not observable.

Otherwise equivalent (same `result` null check → `napi_invalid_arg`, same success path).

---

### `node_api_create_external_sharedarraybuffer`
Bun impl: `/workspace/bun/src/jsc/bindings/napi.cpp:1757-1780`

- **Check ordering (minor):** Same as above — Bun checks pending-exception before not-in-GC; Node does the reverse.
- **Redundant pending-exception check:** Line 1765 `NAPI_RETURN_EARLY_IF_FALSE(env, !env->hasPendingException(), napi_pending_exception)` is dead code — `NAPI_PREAMBLE` at line 1762 already returned on pending exception. No behavioral effect, just redundant.
- **`can_call_into_js` check:** Missing in Bun (same systemic `NAPI_PREAMBLE` difference as above).
- **`V8_ENABLE_SANDBOX` path:** Node returns `napi_no_external_buffers_allowed` when built with V8 sandbox. Bun has no such path (JSC has no sandbox), so always succeeds. Not a bug — inherent engine difference.
- **Finalizer when `finalize_cb == nullptr`:** Node skips allocating a deleter struct; Bun always allocates a `NapiNoEnvExternalBufferDestructor` but its `run()` no-ops when `m_cb` is null (lines 1744-1746). Behaviorally equivalent, minor allocation overhead only.

Otherwise equivalent: same arg validation (`env`, `result`), same success return clearing last_error, same finalizer `(data, hint)` signature.

---

### Summary
All three functions are behaviorally compatible for normal inputs. The only notable differences are (1) Bun's `NAPI_PREAMBLE` lacks the `can_call_into_js` → `napi_cannot_run_js` check (systemic), and (2) the pending-exception vs not-in-GC check ordering is swapped (only observable in the pathological "experimental-version finalizer during GC with pending exception" case). No wrong status codes, no missing null checks, no missing pending-exception checks.

**Relevant files:**
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 89-168 macros; 1687-1780 impls)
- `/tmp/node26_js_native_api_v8.cc` (lines 3144-3255)
- `/tmp/node26_js_native_api_v8.h` (lines 206-245 macros)

---

## reference & finalizer

# N-API Reference & Finalizer Function Comparison: Bun vs Node 26

## `napi_create_reference`
- **Wrong version gate for primitive references** (napi.cpp:1126): Bun allows non-object/function/symbol values only when `nm_version == NAPI_VERSION_EXPERIMENTAL`. Node 26 allows them when `module_api_version >= 10` (node26_js_native_api_v8.cc:2829-2833). An addon targeting NAPI version 10 that calls `napi_create_reference` on a number/string/boolean/bigint gets `napi_ok` from Node but `napi_invalid_arg` from Bun.
- Minor: arg-check order swapped (Bun checks `result` then `value` at napi.cpp:1118-1119; Node checks `value` then `result`). Not observable — both paths return `napi_invalid_arg`.

## `napi_delete_reference`
OK

## `napi_reference_ref`
- **Post-collection refcount semantics** (NapiRef.cpp:9-23): Node's `Reference::Ref()` returns `0` without incrementing when the underlying persistent has been cleared by the weak callback (node26_js_native_api_v8.cc:690-699). Bun's `NapiRef::ref()` unconditionally increments `refCount` and writes the incremented value to `*result`. After a weak reference's target is collected, Node writes `0` to `*result` while Bun writes `1` (or `prev+1`). Observable to addons that inspect the returned count after GC.

## `napi_reference_unref`
OK

## `napi_get_reference_value`
OK

## `napi_add_finalizer`
- **Wrong status code for non-object value** (napi.cpp:1163): When `js_object` is not an object, Bun returns `napi_object_expected`. Node 26 returns `napi_invalid_arg` (node26_js_native_api_v8.cc:3640: `RETURN_STATUS_IF_FALSE(env, v8_value->IsObject(), napi_invalid_arg)`).

## `node_api_post_finalizer`
- **Extra null check on `finalize_cb`** (napi.cpp:1189): Bun returns `napi_invalid_arg` when `finalize_cb == NULL`. Node 26 does not check `finalize_cb` and returns `napi_ok` (node26_js_native_api_v8.cc:3658-3667); the enqueued `TrackedFinalizer` later no-ops via `if (finalize_callback == nullptr) return;` (node26_js_native_api_v8.cc:618).
- Minor: Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:1188), which declares a JSC throw scope and early-returns `napi_pending_exception` if a VM-level exception is on the scope. Node uses only `CHECK_ENV` (no exception check, `node_api_basic_env` signature). Unlikely to be observable in practice since no VM exception should be on the scope at a finalizer entry point, but it is a stricter preamble than Node's.

---

### Relevant file paths
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 89-173 macros; 1112-1260 impls)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 389-408 `checkGC`; 789-878 `NapiRef`)
- `/workspace/bun/src/jsc/bindings/NapiRef.cpp` (lines 9-35 `ref`/`unref`)
- `/tmp/node26_js_native_api_v8.cc` (lines 690-720 `Reference::Ref/Unref/Get`; 2818-2925 ref APIs; 3625-3667 finalizer APIs)
- `/tmp/node26_js_native_api_v8.h` (lines 191-299 macros)

---

## handle scope

# N-API Handle Scope: Bun vs Node 26

## napi_open_handle_scope
- Validation order (env → GC check → result) and status codes match.
- Minor: Bun's `NapiHandleScope::open` (napi_handle_scope.cpp:106) returns `nullptr` when the JSC mutator is `Sweeping`, so `*result` is written as `NULL` while status is `napi_ok` (napi_body.rs:1118-1119). Node always writes a non-null wrapper. Likely JSC-necessitated, but observable to addons that assert the out-param is non-null when called from a finalizer under a non-experimental module version.
- Bun does not maintain `env->open_handle_scopes` counter (only observable via `napi_close_*`, see below).

## napi_close_handle_scope
- **Null `scope`**: Node does `CHECK_ARG(env, scope)` → returns `napi_invalid_arg` (via `napi_set_last_error`). Bun (napi_body.rs:1130-1133) treats null `scope` as a no-op and returns `napi_ok` (clearing last_error).
- **Mismatch**: Node returns `napi_handle_scope_mismatch` when `env->open_handle_scopes == 0`. Bun never returns `napi_handle_scope_mismatch`; instead `NapiHandleScope::close` (napi_handle_scope.cpp:125) does `RELEASE_ASSERT_WITH_MESSAGE(current == global->m_currentNapiHandleScopeImpl.get(), ...)`, so an unbalanced/extra close **aborts the process** rather than returning a status code.

## napi_open_escapable_handle_scope
- Same as `napi_open_handle_scope`: validation/status OK; may write `nullptr` during sweep; no `open_handle_scopes` count.

## napi_close_escapable_handle_scope
- Same two differences as `napi_close_handle_scope`:
  - Null `scope` → Bun returns `napi_ok` (napi_body.rs:1237-1240); Node returns `napi_invalid_arg`.
  - Bun never returns `napi_handle_scope_mismatch`; aborts on unbalanced close instead.

## napi_escape_handle
- **Missing null check on `escapee`**: Node has `CHECK_ARG(env, escapee)` → `napi_invalid_arg`. Bun (napi_body.rs:1244-1262) never checks `escapee`; a null `escapee` is passed through `scope.escape(JSValue::ZERO)`, `*result` is set to the null `escapee`, and `napi_ok` is returned.
- Arg-check order differs (Node: scope → escapee → result; Bun: result → scope), but both paths return `napi_invalid_arg` so not status-observable.
- `napi_escape_called_twice` path matches (both go through `set_last_error`).

---

**Files referenced:**
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 1110-1263, 206-236, 415-446, 87-127, 156-160)
- `/workspace/bun/src/jsc/bindings/napi_handle_scope.cpp` (lines 66-75, 95-133)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 394-408)
- `/tmp/node26_js_native_api_v8.cc` (lines 2927-3001)
- `/tmp/node26_js_native_api_v8.h` (lines 132-143, 206-220)

---

## promise

# N-API Promise Functions Comparison — Bun vs Node.js 26

## `napi_create_promise`

- **Missing "not in GC" check** (napi_body.rs:1548). Node's `NAPI_PREAMBLE` does `CHECK_ENV_NOT_IN_GC` → `CheckGCAccess()`; Bun's `preamble!` macro (napi_body.rs:428-435) only does env-null + pending-exception, with no `env.check_gc()`. Observable when called from a GC finalizer under `NAPI_VERSION_EXPERIMENTAL`: Node aborts with a fatal error, Bun proceeds.
- **Missing `can_call_into_js` check.** Node's `NAPI_PREAMBLE` returns `napi_cannot_run_js` (module_api_version ≥ 10) or `napi_pending_exception` (< 10) when the env can no longer call into JS (terminating). Bun's `preamble!` has no equivalent and proceeds to create the promise.
- Arg null-checks (`deferred`, `promise`) and their order match. Otherwise OK.

## `napi_resolve_deferred`

- **Missing null check on `resolution`** (napi_body.rs:1571). Node does `CHECK_ARG(env, result)` → returns `napi_invalid_arg` if the resolution value is `NULL` (js_native_api_v8.cc:314). Bun calls `resolution_.get()` with no null check and passes an empty `JSValue` straight into `prom.resolve()`. An addon passing `NULL` gets `napi_invalid_arg` in Node; in Bun it reaches JSC with an empty value.
  - Secondary effect: in Node the `deferred` is **not** freed on this early return, so the addon may retry. In Bun the `deferred` is `heap::take`n (and will be dropped) before any resolution handling (napi_body.rs:1569), so there is no non-freeing early-return path after the preamble.
- **Missing "not in GC" check** — same as `napi_create_promise` (`preamble!` lacks `check_gc()`).
- **Missing `can_call_into_js` check** — same as above.
- **Different failure status code** (napi_body.rs:1573-1574). When resolve fails, Node returns `napi_generic_failure` via `RETURN_STATUS_IF_FALSE(env, success.FromMaybe(false), napi_generic_failure)` (js_native_api_v8.cc:332). Bun returns `napi_pending_exception`. (In practice Bun's `resolve` only errs on `JsTerminated`, which Node would have short-circuited earlier via `can_call_into_js`.)
- Neither Node nor Bun null-checks `deferred` itself (both UB/crash on null) — matches.

## `napi_reject_deferred`

Same differences as `napi_resolve_deferred`:
- **Missing null check on `rejection`** (napi_body.rs:1589) — Node `CHECK_ARG(env, result)` → `napi_invalid_arg`; Bun passes empty JSValue through.
- **Missing "not in GC" check** (via `preamble!`).
- **Missing `can_call_into_js` check**.
- **Different failure status**: Bun returns `napi_pending_exception` (napi_body.rs:1592) where Node returns `napi_generic_failure`.

## `napi_is_promise`

OK. (Arg-check order differs — Bun checks `is_promise` out-ptr at napi_body.rs:1607 before `value` at :1609, Node checks `value` first — but both return `napi_invalid_arg`, so not observable.)

---

**Relevant files:**
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 415-445 macros; 1542-1615 promise impls)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 389-407 `inGC`/`checkGC`)
- `/tmp/node26_js_native_api_v8.cc` (lines 309-334 `ConcludeDeferred`; 3514-3555 promise impls)
- `/tmp/node26_js_native_api_v8.h` (lines 206-242 `CHECK_ENV_NOT_IN_GC`, `NAPI_PREAMBLE`)

---

## script & memory & version

# N-API Comparison: script & memory & version

## napi_get_version
**OK** — Bun (napi_body.rs:1531-1539) and Node (js_native_api_v8.cc:3506-3512) both: check env null → `napi_invalid_arg`, check result null → `napi_invalid_arg`, write `10`, clear last_error. Neither checks GC (Node uses plain `CHECK_ENV`, Bun's `get_env!` is null-check only).

---

## napi_adjust_external_memory
- **Returned value semantics differ**: Bun (napi.cpp:1313-1318) tracks `env->m_externalMemory` per-`napi_env` and returns that. Node (js_native_api_v8.cc:3677-3678) returns `isolate->AdjustAmountOfExternalAllocatedMemory(...)`, an **isolate-wide** total. Observable when multiple addons / the host also report external memory — the absolute value an addon sees will differ.
- **Extra pending-exception check**: Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:1307) which expands to `NAPI_RETURN_IF_VM_EXCEPTION` — returns `napi_pending_exception` if a JSC VM exception is already set on entry. Node uses plain `CHECK_ENV` (3674) with no exception check (this is a `node_api_basic_env` function). Likely unobservable in practice, but stricter than Node.

---

## napi_run_script
- **Missing "not in GC" check**: Node's `NAPI_PREAMBLE` (3602) → `CHECK_ENV_NOT_IN_GC` → `CheckGCAccess()`. Bun's `NAPI_PREAMBLE_NO_THROW_SCOPE` (napi.cpp:2947) does only the null-env check; `env->checkGC()` is never called. Only observable for modules built with `NAPI_VERSION_EXPERIMENTAL`, where Node fatals.
- **Missing `can_call_into_js` check**: Node's `NAPI_PREAMBLE` returns `napi_cannot_run_js` (module_api_version ≥ 10) or `napi_pending_exception` (< 10) when `env->can_call_into_js()` is false (env teardown). Bun has no equivalent guard here and will attempt to evaluate.
- **Wrong status code on script error**: When compilation or execution throws (syntax error / runtime exception), Node returns **`napi_generic_failure`** via `CHECK_MAYBE_EMPTY(env, maybe_script, napi_generic_failure)` (3615, 3618) — the exception is stashed by the `TryCatch` destructor. Bun returns **`napi_pending_exception`** (napi.cpp:2958, 2967). An addon testing `status == napi_generic_failure` will behave differently.

---

## napi_set_instance_data
- **Extra pending-exception check**: Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:2981) which includes `NAPI_RETURN_IF_VM_EXCEPTION`. Node uses plain `CHECK_ENV` only (3688). Same caveat as `napi_adjust_external_memory` — Node treats this as a basic-env function callable with no exception gate; Bun is stricter. Likely unobservable.
- Otherwise OK: neither calls GC check; neither invokes the previous finalizer when overwriting (Node `delete`s the old `TrackedFinalizer` without running it; Bun just overwrites `instanceDataFinalizer`).

---

## napi_get_instance_data
- **Extra pending-exception check**: Bun uses `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:2937); Node uses plain `CHECK_ENV` (3706). Same minor strictness difference as above.
- Otherwise OK: arg-check order, null-data handling, and last_error clearing match.

---

### Relevant files
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 415-446 macros, 1531-1539 `napi_get_version`)
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 89-173 macros, 1303-1320, 2934-2987)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 389-408 `checkGC`, 513-521 `instanceData`/`m_externalMemory`)
- `/tmp/node26_js_native_api_v8.cc` (lines 3506-3715)
- `/tmp/node26_js_native_api_v8.h` (lines 132-143 `CheckGCAccess`, 206-243 macros)
- `/tmp/node26_version.h` (line 103: `NODE_API_SUPPORTED_VERSION_MAX 10`)

---

## async work

# N-API Async Work — Bun vs Node 26 Comparison

General note applying to multiple functions below: Bun's `preamble!` macro (napi_body.rs:428-436) checks env-not-null and pending-exception only. Node's `NAPI_PREAMBLE` additionally does `CheckGCAccess()` and a `can_call_into_js()` check (returning `napi_cannot_run_js` for module_api_version ≥ 10, else `napi_pending_exception`). Bun's plain `get_env!` (napi_body.rs:415) never calls `check_gc()` unless the function body does so explicitly.

---

### `napi_create_async_work`
- **Missing GC check** (napi_body.rs:2160 uses `get_env!`): Node uses `CHECK_ENV_NOT_IN_GC`.
- **Arg-check order reversed** (napi_body.rs:2161-2164): Bun checks `result` before `execute`; Node checks `execute` then `result`. Same status code either way (`napi_invalid_arg`), so not user-observable.
- **Missing `async_resource` object check**: Node does `CHECK_TO_OBJECT` on a non-null `async_resource` and returns `napi_object_expected` if it isn't coercible to an object (node_api.cc:1285). Bun ignores the argument entirely.
- **Missing `async_resource_name` null/string check**: Node does `CHECK_TO_STRING` → returns `napi_invalid_arg` if null and `napi_string_expected` if not coercible to string (node_api.cc:1291). Bun ignores it.
- **Wrong parameter type in Rust signature** (napi_body.rs:2153): `_async_resource_name: *const c_char` — should be `napi_value`. ABI-equivalent on 64-bit so harmless in practice, but it's wrong and prevents ever validating it.

### `napi_delete_async_work`
- **Missing GC check** (napi_body.rs:2176 `get_env!`): Node uses `CHECK_ENV_NOT_IN_GC` (node_api.cc:1307).
- Otherwise OK (both null-check `work` → `napi_invalid_arg`).

### `napi_queue_async_work`
OK. Both do plain env check (no GC check — Node uses `CHECK_ENV`, basic-env variant) and null-check `work`.

### `napi_cancel_async_work`
OK. Both do plain env check + null-check `work`; on cannot-cancel Bun returns `napi_generic_failure` (napi_body.rs:2218) and Node returns the same via `ConvertUVErrorCode(UV_EBUSY)` → `napi_generic_failure`.

### `napi_async_init`
- **Missing GC check** (napi_body.rs:1145 `get_env!`): Node uses `CHECK_ENV_NOT_IN_GC`.
- **Missing null check on `async_resource_name`**: Node `CHECK_ARG(env, async_resource_name)` → `napi_invalid_arg` (node_api.cc:964). Bun ignores.
- **Missing null check on `result`**: Node `CHECK_ARG(env, result)` (node_api.cc:965). Bun at napi_body.rs:1149 does `unsafe { *async_ctx = ... }` with no null check — **null-pointer deref / crash** if addon passes `NULL` where Node returns `napi_invalid_arg`.
- **Missing `async_resource` object check**: Node `CHECK_TO_OBJECT` on non-null resource → `napi_object_expected`. Bun ignores.
- **Missing `async_resource_name` string check**: Node `CHECK_TO_STRING` → `napi_string_expected`. Bun ignores.
- **Stubbed semantics**: Bun writes the `env` pointer itself as the async context; no `AsyncContext` created, so `async_hooks` integration is absent (acknowledged by "we don't support async contexts" comment, napi_body.rs:1136).

### `napi_async_destroy`
- **Missing GC check** (napi_body.rs:1160 `get_env!`): Node uses `CHECK_ENV_NOT_IN_GC`.
- **Missing null check on `async_context`**: Node `CHECK_ARG(env, async_context)` → `napi_invalid_arg` (node_api.cc:991). Bun returns `napi_ok` regardless.
- Stubbed (no-op).

### `napi_make_callback`
- **Missing GC check / `can_call_into_js` check**: `preamble!` (napi_body.rs:1176) lacks both; Node's `NAPI_PREAMBLE` has both (may return `napi_cannot_run_js`).
- **Missing `recv` null check**: Node `CHECK_ARG(env, recv)` → `napi_invalid_arg` (node_api.cc:1009). Bun (napi_body.rs:1184-1188) treats empty `recv` as `undefined` and proceeds.
- **Missing `recv` object check**: Node `CHECK_TO_OBJECT(..., recv)` → `napi_object_expected` if not coercible to object (node_api.cc:1017). Bun passes any value through as `this`.
- **Wrong status for non-function `func`**: Node `CHECK_TO_FUNCTION` returns `napi_invalid_arg` for both null and non-function `func` (js_native_api_v8.h:261-267). Bun returns `napi_function_expected` (napi_body.rs:1181).
- **Missing `argv` null check when `argc > 0`**: Node returns `napi_invalid_arg` (node_api.cc:1010-1012). Bun (napi_body.rs:1189) silently substitutes an empty arg slice and calls with zero args.
- **Out-param written on exception path**: Bun writes the thrown exception value into `*result` (napi_body.rs:1200-1206) before returning `napi_pending_exception`. Node leaves `*result` untouched on the exception path (node_api.cc:1042-1049 — result only written in the `else` branch).
- **Incorrect exception detection**: Bun checks `res.is_any_error()` (napi_body.rs:1209) to decide `napi_pending_exception`. If the callee *returns* an `Error` object without throwing, Bun wrongly reports `napi_pending_exception`; Node only reports it when `try_catch.HasCaught()`.
- **Semantic stub**: no microtask drain / async-context enter-exit (Node goes through `node::MakeCallback`).

### `napi_open_callback_scope`
- **Missing env null check** (napi_body.rs:1281-1289 never reads `_env`): Node `CHECK_ENV` → `napi_invalid_arg` for null env. Bun returns `napi_ok`.
- **Missing `result` null check**: Node `CHECK_ARG(env, result)` → `napi_invalid_arg` (node_api.cc:933). Bun ignores.
- **`*result` never written**: Node writes a non-null scope handle into `*result` (node_api.cc:938). Bun leaves the caller's out-param uninitialized — addon reads garbage.
- **`last_error` not cleared**: Node calls `napi_clear_last_error`. Bun returns the raw `napi_ok` constant without touching `env->last_error`.
- No scope-count tracking (see `napi_close_callback_scope`).

### `napi_close_callback_scope`
- **Missing env null check** (napi_body.rs:1292-1298): Node `CHECK_ENV` → `napi_invalid_arg`. Bun returns `napi_ok`.
- **Missing `scope` null check**: Node `CHECK_ARG(env, scope)` → `napi_invalid_arg` (node_api.cc:948). Bun returns `napi_ok`.
- **Missing scope-mismatch check**: Node returns `napi_callback_scope_mismatch` if `env->open_callback_scopes == 0` (node_api.cc:949-951). Bun never returns this status.
- **`last_error` not cleared**: Node calls `napi_clear_last_error`; Bun returns raw `napi_ok` without updating `env->last_error`.

---

**Files referenced:**
- `/workspace/bun/src/runtime/napi/napi_body.rs`
- `/tmp/node26_node_api.cc`
- `/tmp/node26_js_native_api_v8.h`

---

## threadsafe function

# N-API Threadsafe Function Comparison: Bun vs Node.js 26

Files compared:
- Bun: `/workspace/bun/src/runtime/napi/napi_body.rs`
- Node: `/tmp/node26_node_api.cc`

Note on `CHECK_NOT_NULL`: this is Node's hard-abort assertion (from `src/util.h`), not a status-return. Where Node uses `CHECK_NOT_NULL(func)` and Bun dereferences `func` unchecked, both crash on null — treated as equivalent below.

---

### `napi_create_threadsafe_function`

- **Missing `async_resource_name` null check** (Bun :3064 takes `_async_resource_name` and ignores it). Node :1364 `CHECK_ARG(env, async_resource_name)` → returns `napi_invalid_arg` when `async_resource_name == NULL`. Bun returns `napi_ok`.
- **Missing `initial_thread_count > 0` check** (Bun :3066 / :3112). Node :1365 `RETURN_STATUS_IF_FALSE(env, initial_thread_count > 0, napi_invalid_arg)` → returns `napi_invalid_arg` when `initial_thread_count == 0`. Bun accepts 0.
- **Missing "not in GC" check.** Node :1363 uses `CHECK_ENV_NOT_IN_GC` (fatal error under `NAPI_VERSION_EXPERIMENTAL` if called from a GC finalizer). Bun :3074 uses `get_env!` which only null-checks and does not call `env.check_gc()`.
- **Argument-validation order differs.** Node checks in order: `env`, `async_resource_name`, `initial_thread_count`, `result`, then `func`/`call_js_cb`. Bun checks: `env`, `result`, then `func`/`call_js_cb`. Observable when multiple args are invalid.
- **Wrong status code for bad `func` / missing `call_js_cb`.** Bun :3082 returns `napi_function_expected`. Node returns `napi_invalid_arg` in both relevant paths: `CHECK_ARG(env, call_js_cb)` (:1372) and `CHECK_TO_FUNCTION` (:1374 → `RETURN_STATUS_IF_FALSE(..., napi_invalid_arg)`).
- **Non-function `func` accepted when `call_js_cb` is set.** Bun :3078 only validates `func` when `call_js_cb.is_none()`. Node :1373-1375 runs `CHECK_TO_FUNCTION` whenever `func != nullptr`, regardless of `call_js_cb`, so `func != NULL && !IsFunction(func)` → `napi_invalid_arg` in Node but `napi_ok` in Bun.
- **`async_resource` type not validated.** Node :1383 `CHECK_TO_OBJECT(...)` → `napi_object_expected` if `async_resource` is non-null and not object-coercible. Bun ignores `_async_resource` entirely.
- **`async_resource_name` type not validated.** Node :1387 `CHECK_TO_STRING(...)` → `napi_string_expected` if it cannot coerce to String (e.g., a Symbol). Bun ignores it.

---

### `napi_get_threadsafe_function_context`
OK (both crash on null `func`/`result`; both return raw `napi_ok` without touching `last_error`).

---

### `napi_call_threadsafe_function`
- **Minor: blocking-mode comparison inverted at the edge.** Bun :3172 tests `is_blocking == NAPI_TSFN_BLOCKING` (== 1); Node `Push` :244 tests `mode == napi_tsfn_nonblocking` (== 0). For an out-of-range enum value (e.g., `2`), Node treats it as blocking, Bun as non-blocking. For valid inputs (0/1) behavior matches.
- Otherwise OK: queue-full / closing / invalid_arg paths (Bun `enqueue` :2777-2808 vs Node `Push` :238-266) match; neither sets `last_error`.

---

### `napi_acquire_threadsafe_function`
OK (Bun `acquire` :2964-2971 vs Node `Acquire` :268-278; identical status returns, no `last_error`).

---

### `napi_release_threadsafe_function`
OK (Bun `release_locked` :3000-3041 vs Node `Release` :280-309; `napi_invalid_arg` on zero thread-count, `napi_ok` otherwise, no `last_error`).

---

### `napi_unref_threadsafe_function`
- **Bun checks `env != NULL`; Node does not.** Bun :3201 `get_env!(env_)` returns `napi_invalid_arg` when `env == NULL`. Node :1444-1448 ignores `env` entirely (only `CHECK_NOT_NULL(func)`) and returns `napi_ok` regardless of `env`.
- **Bun sets `last_error`; Node does not.** Bun :3208 `env.ok()` writes `napi_ok` into `env->last_error`. Node `Unref()` :371-374 just `return napi_ok;` without touching `last_error`. Observable via a subsequent `napi_get_last_error_info` (Bun clears a prior error, Node preserves it).

---

### `napi_ref_threadsafe_function`
- **Bun checks `env != NULL`; Node does not.** Bun :3217 `get_env!(env_)` → `napi_invalid_arg` on null `env`. Node :1450-1454 ignores `env`.
- **Bun sets `last_error`; Node does not.** Bun :3224 `env.ok()` vs Node `Ref()` :377-380 bare `return napi_ok;`. Same observability as above.

---

## cleanup hooks & env lifecycle

# N-API Comparison: Cleanup Hooks & Env Lifecycle

## `napi_add_env_cleanup_hook`
- **Bun returns `napi_ok` when `fun == NULL`** (napi.cpp:3242-3245 `if (function) {...}` then `NAPI_RETURN_SUCCESS`). Node returns `napi_invalid_arg` via `CHECK_ARG(env, fun)` (node_api.cc:814).
- Bun sets `last_error = napi_ok` on success (`NAPI_RETURN_SUCCESS`, napi.cpp:3245); Node returns raw `napi_ok` without touching `last_error` (node_api.cc:818). Observable via `napi_get_last_error_info`.
- Bun's `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:3241) may return `napi_pending_exception` if a JSC VM exception is pending; Node uses bare `CHECK_ENV` (no exception check) since this is a `node_api_basic_env` API. Minor.

## `napi_remove_env_cleanup_hook`
- **Bun returns `napi_ok` when `fun == NULL`** (napi.cpp:3271 `if (function != nullptr)` then `NAPI_RETURN_SUCCESS`). Node returns `napi_invalid_arg` via `CHECK_ARG(env, fun)` (node_api.cc:825).
- Bun sets `last_error = napi_ok` on success; Node returns raw `napi_ok` without touching `last_error` (node_api.cc:829).
- Same minor VM-exception check difference as above (napi.cpp:3266).

## `napi_add_async_cleanup_hook`
- **Bun returns `napi_ok` when `hook == NULL`** (napi.cpp:3253-3259). Node returns `napi_invalid_arg` via `CHECK_ARG(env, hook)` (node_api.cc:874). When `hook == NULL && remove_handle != NULL`, Bun leaves `*remove_handle` unwritten but reports success — caller may read garbage.
- **Bun aborts on duplicate `(hook, arg)` pairs** (napi.h:354-357 `NAPI_RELEASE_ASSERT(function != async->function || data != async->data, ...)`). Node allows duplicates: each call allocates a fresh `napi_async_cleanup_hook_handle__` and registers `(Hook, this)` where `this` is unique (node_api.cc:837, 876-877), so the underlying cleanup queue never sees a duplicate key.
- Same minor VM-exception check difference (napi.cpp:3252).

## `napi_remove_async_cleanup_hook`
- Bun: if the handle is not found in `m_cleanupHooks`, the handle is **not freed** (napi.h:374-386 only `delete handle` inside the match). Node always does `delete remove_handle;` (node_api.cc:888). Observable as a leak (and, in Node, the destructor is also what invokes `done_cb_` to signal async-cleanup completion — node_api.cc:841-849).
- Bun dereferences `handle->env` and runs `NAPI_PREAMBLE_NO_PENDING_CHECK(env)` / `NAPI_RETURN_SUCCESS(env)` (napi.cpp:3286-3293), which (a) may return `napi_pending_exception` if the env's VM has an exception, and (b) writes `napi_ok` into that env's `last_error`. Node never touches any env: it has no env param and returns bare `napi_invalid_arg` / `napi_ok` (node_api.cc:885-891).
- Null-handle → `napi_invalid_arg` without setting last_error: matches Node (napi.cpp:3282-3284 vs node_api.cc:886).

## `napi_get_uv_event_loop`
- Argument validation and last_error handling: OK (matches Node).
- **Semantic**: on POSIX, Bun writes a `*mut bun::EventLoop` rather than a real `uv_loop_t*` (napi_body.rs:2252-2258). Addons that pass the result to libuv APIs will misbehave on non-Windows. (Windows path returns a real `uv_loop_t*`.)

## `napi_get_node_version`
OK.

## `node_api_get_module_file_name`
- Bun may write `*result = NULL`: `env->filename` is only assigned on the `napi_register_module_v1` path (BunProcess.cpp:752); on the legacy `napi_module_register` / `executePendingNapiModule` path (napi.cpp:720) `env->filename` stays `nullptr` (napi.h:515 default). Node's `GetFilename()` returns `std::string::c_str()` so it is never NULL — empty string at worst (node_api.cc:744, 1462).
- Bun's `NAPI_PREAMBLE_NO_PENDING_CHECK` (napi.cpp:1611) may return `napi_pending_exception` if a VM exception is pending; Node uses bare `CHECK_ENV` (node_api.cc:1459). Minor.

## `napi_module_register`
- Bun null-checks `mod` and `mod->nm_register_func` inline (napi.cpp:804) and stashes an error JSValue immediately when either is NULL; Node dereferences `mod` unconditionally (node_api.cc:805-807) and defers the `init == nullptr` → "Module has no declared entry point." throw to `napi_module_register_by_symbol` (node_api.cc:745-748). Functionally equivalent for valid inputs; Bun is defensive where Node would crash on `mod == NULL`.
- No status-code surface (void return) — otherwise OK.

---

**Files referenced:**
- `/workspace/bun/src/jsc/bindings/napi.cpp` (lines 89-173, 795-812, 1608-1615, 3237-3294)
- `/workspace/bun/src/jsc/bindings/napi.h` (lines 322-387, 515)
- `/workspace/bun/src/jsc/bindings/BunProcess.cpp` (line 752)
- `/workspace/bun/src/runtime/napi/napi_body.rs` (lines 415-446, 2221-2261)
- `/tmp/node26_node_api.cc` (lines 804-891, 1171-1179, 1315-1322, 1456-1464)
- `/tmp/node26_js_native_api_v8.h` (lines 206-220)

---

