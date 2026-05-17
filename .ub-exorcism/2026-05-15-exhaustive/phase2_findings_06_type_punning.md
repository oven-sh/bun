# Phase 2 Findings — Bucket 6: Type Punning via `transmute` / `union`

Run: 2026-05-15-exhaustive · Sweeper: static-bucket-sweeper-06 · Date: 2026-05-16

Scope (UB-TAXONOMY §6): every `core::mem::transmute` / `mem::transmute_copy` /
`std::mem::transmute` call, plus every `union` declaration in
`src/` + `packages/` (Rust crates only — `.zig` siblings are reference-only).

Cross-bucket touchpoints: Bucket 4 (Validity — enum discriminant), Bucket 15
(Lifetime aliasing — `'_ → 'static` widen), Bucket 18 (FFI fn-ptr typing).

---

## 1. Quantitative summary

| Metric                                                | Count |
| ----------------------------------------------------- | ----- |
| `mem::transmute` call sites in `src/`                 | 23    |
| `mem::transmute_copy` call sites in `src/`            | 4     |
| `mem::transmute` in `packages/bun-native-plugin-rs/`  | 1     |
| **Total transmute sites in Rust workspace**           | **28** |
| `union` declarations in `src/` + `packages/`          | 40    |
| Bindgen-generated unions (`*_sys/`, `jsc/generated`)  | 30    |
| Hand-rolled unions (Bun runtime / install / sql)      | 10    |

(`mem::transmute` raw count of 25 + 1 from earlier scan was inflated by two
multi-line invocations counted once each; the canonical list below is the
de-duplicated 28.)

---

## 2. Per-site classification

Legend: **S** = sound; **L** = latent / unreachable today but `pub`;
**W** = weak/unproven (relies on caller contract that is not statically
enforced); **U** = unsound under documented inputs.

| # | Site (file:line) | source → target | Layout-compatible? | Verdict | Cross-refs | EXP |
| - | ---------------- | --------------- | ------------------ | ------- | ---------- | --- |
| 1 | `src/bundler/transpiler.rs:308` | `BundleOptions<'_>` → `BundleOptions<'a>` | Y (lifetime-only) | S | B15 | — |
| 2 | `src/libuv_sys/libuv.rs:292` | `c_int` → `HandleType` (`#[repr(C)]` enum) | Y if range-checked | S — wrapper does `0..=File` check, else returns `Unknown` | B4 | — |
| 3 | `src/libuv_sys/libuv.rs:623` | `unsafe extern "C" fn(*mut Self)` → `unsafe extern "C" fn(*mut uv_handle_t)` | Y (`UvHandle` prefix invariant) | S — `unsafe trait UvHandle` enforces `#[repr(C)]` + `uv_handle_t` prefix; 95 `assert_size!`/`assert_offset!` validate it | B18, T inventory | — |
| 4 | `src/libuv_sys/libuv.rs:989` | `usize` → `fn(*mut T, ReturnCode)` | Y on all current targets | W — `usize` and `fn`-ptr size parity not statically asserted (none of `assert_size`); CHERI/wasm32 break it | B18 | T-inventory candidate |
| 5 | `src/bundler/linker_context/scanImportsAndExports.rs:1682` | `u16` → `PropertyIdTag` (`#[repr(u16)]`) | Y if validity holds | W — relies on every set bit corresponding to a declared discriminant; SAFETY cites populator (`fill_property_bit_set`), no `try_from` exists in bun_css | B4 | F-NF6-1 / EXP-064 checked-bit-pattern vehicle |
| 6 | `src/sys/lib.rs:5923` | `*mut c_void` → `T` (generic, fn-ptr) via `transmute_copy` | Y — const-assert size parity | S — fn pointers not `bytemuck::Pod`; irreducible | B18 | — |
| 7 | `src/sys/lib.rs:6021` | same as #6 (macro body) | Y | S | B18 | — |
| 8 | `src/resolver/lib.rs:4260` | `Option<&'_ dyn StandaloneModuleGraph>` → `Option<&'a dyn …>` | Y (lifetime-only on trait obj) | S — caller-enforced lifetime widening; documented "pointee outlives 'a" | B15 | — |
| 9 | `src/boringssl_sys/boringssl.rs:496` | `unsafe extern "C" fn(*mut c_void)` → `sk_GENERAL_NAME_free_func` | Y — ABI-identical (both take `*mut _`) | S | B18, T-inventory | — |
| 10 | `src/boringssl_sys/boringssl.rs:512` | reverse of #9 | Y | S | B18 | — |
| 11 | `src/bundler/LinkerContext.rs:2288` | `Renamer<'_, '_>` → `Renamer<'_, '_>` | Y (lifetime-only) | S — lifetime rebind around invariance behind `&mut`; documented | B15 | — |
| 12 | `src/bun_alloc/lib.rs:560` | `std::sync::MutexGuard<'_, ()>` → `…<'static, ()>` | Y (lifetime-only) | S — `bun_alloc::Mutex` is `'static` BSS singleton; pattern documented | B15 | — |
| 13 | `src/perf/tracy.rs:726` | `*mut c_void` → `T` (fn-ptr) via `transmute_copy` | Y — all current monomorphisations are `tracy_fns::*` unsafe extern fn pointers; only a debug size assert exists | H — current source is reviewed sound under the private-call-site audit, but harden to a compile-time assertion / typed dlsym macro so a future non-fn `T` cannot silently enter release builds | B18 | hardening only after Codex call-site audit |
| 14 | `src/perf/tracy.rs:798` | same as #13 | H | (same) | B18 | (same) |
| 15 | `src/css/css_parser.rs:2718` | `CssModuleExports<'_>` → `CssModuleExports<'static>` | Y (lifetime-only on `ArrayHashMap<&'a [u8], …>`) | C — EXP-077 Miri-confirms the safe-API dangling-reference shape. Current reviewed in-tree callers only read `result.code`, but the public result type is unsound until it carries the bump lifetime or owns the exported strings. | B15 | EXP-077 / re-type result |
| 16 | `src/css/css_parser.rs:2723` | `CssModuleReferences<'_>` → `…<'static>` | C | EXP-077 (same) | B15 | EXP-077 / re-type result |
| 17 | `src/cares_sys/c_ares.rs:2049` | `i32` → `Error` (`#[repr(i32)]`) | Y if range-checked | S — `assert!(n in 1..=ARES_ENOSERVER)` immediately above; cited contiguous discriminants | B4 | — |
| 18 | `src/event_loop/AnyTask.rs:69` | `fn(*mut T) -> JsResult<()>` → `fn(*mut c_void) -> JsResult<()>` | Y — `*mut T` and `*mut c_void` are ABI-identical for `T: Sized` | S | B18 | — |
| 19 | `src/errno/linux_errno.rs:192` | `u16` → `E` (`#[repr(u16)]` errno enum) | N — `E` is sparse on Windows; on Linux dense `0..=137` but **kernel may return `134` for `EHWPOISON+1` which is OUT of declared range** | **U → confirmed UB; LATENT (no live callers in-tree)** | B4 — **EXP-002** | EXP-002 |
| 20 | `src/errno/windows_errno.rs:254` | `u16` → `E` (`#[repr(u16)]`) | N — sparse enum (`0..=137` + `~3000–4095`); `from_raw` has only `debug_assert!(from_repr(n).is_some())` before the transmute | **U — safe `pub const fn`; release builds compile out the debug assertion, so safe callers can construct an invalid enum** | B4 | **EXP-097** |
| 21 | `src/errno/lib.rs:310` | `u16` → `SystemErrno` (`#[repr(u16)]`) | N on Windows (same sparse shape as #20) | **U — safe `pub const fn`; no Windows validity check, and the POSIX debug assertion is also not a release safety boundary** | B4 | **EXP-097** |
| 22 | `src/runtime/ffi/FFIObject.rs:28` | `usize` → `Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>` | Y — null-pointer-optimised `Option<fn>` is layout-compatible with single pointer | S — Rust-sound; `addr` is user-supplied via `bun:ffi`, so a bad value crashes when JSC calls it (hostile-input concern, not UB) | B18 | — |
| 23 | `src/runtime/image/backend_wic.rs:923` | `*mut c_void` (GetProcAddress result) → `WICConvertBitmapSourceFn` | Y — fn-pointer typing of a `GetProcAddress` symbol | S | B18, J-inventory | — |
| 24 | `src/runtime/node/fs_events.rs:164` | `*mut c_void` → `T` (fn-ptr) via `transmute_copy` | Y — const-assert size parity | S | B18, D-inventory | — |
| 25 | `src/sys/linux_syscall.rs:209` | `rustix::fs::Stat` → `libc::stat` | Y on `x86_64`/`aarch64`; source const-asserts size/align, and Codex follow-up (`CODEX_TYPE_PUNNING_LAYOUT_SWEEP_2026-05-16.md`) compile-checks public-field offsets for both cfg-enabled targets | S — all-integer POD plus `libc::Padding<MaybeUninit<_>>` for private padding; `cfg`-gated to verified arches | B4 | — |
| 26 | **`packages/bun-native-plugin-rs/src/lib.rs:637`** | `(self.result_raw.loader as u8 as u32)` → `BunLoader` (`#[repr(u32)]` enum, variants `0..=12`) | N — the field is `u8` (cast back to `u32`); a C caller writing **any** byte outside `0..=12` to `loader` yields **immediate UB** at the transmute | **U — confirmed unsound on hostile input; live API surface** | B4 | **EXP-051** |

### Same-site mass: `boringssl_sys` const-assert layouts

`src/boringssl_sys/boringssl.rs` also contains `unsafe impl bun_core::ffi::Zeroable for EVP_MD_CTX`. Not a transmute, but the same family — covered in T-inventory bucket 22 and out of scope here.

---

## 3. Union audit

40 union declarations total. Classification:

### 3.1 Generated FFI bindings — out of bucket-6 scope (sound by construction)

`src/cares_sys/c_ares.rs` (3), `src/libuv_sys/libuv.rs` (16),
`src/boringssl_sys/boringssl.rs` (2), `src/windows_sys/externs.rs` (2),
`src/jsc/generated.rs` (4), `packages/bun-native-plugin-rs/src/sys.rs` (1).

Each is `#[repr(C)]` and read only through a discriminant tag in the
enclosing struct (`uv_handle_type`, `INPUT_RECORD::EventType`,
`KEY_EVENT_RECORD::wRepeatCount`, etc.). The discipline matches the C
header's documented active-field rules. **Bindgen-equivalent — no Bun
risk.**

### 3.2 Hand-rolled active-field-tagged unions

| Union | Tag | Risk | Notes |
| ----- | --- | ---- | ----- |
| `src/install/bin.rs:474` `Value` | `Bin::tag` (separate field) | S | Pattern match on tag before each read; PORTING.md §Tagged-unions documented |
| `src/install/PackageManagerTask.rs:625` `Data` | `task.tag` | S | Matched in `process_task` |
| `src/install_types/resolver_hooks.rs:411` `DependencyVersionValue` | enclosing enum tag | S | Mirrors Zig `DependencyVersion` |
| `src/event_loop/AnyEventLoop.rs:314` `EventLoopTaskPtr` | discriminant `is_mini` | S | Documented in event-loop module |
| `src/bun_alloc/lib.rs:1008` `WTFStringImplPtr` | tag bit in pointer | S | Tagged-pointer convention; covered by `tagged_pointer.rs` (N-inventory) |
| `src/bun_alloc/lib.rs:1262` `StringImpl` | 8-bit kind field | S | Mirrors `BunString` C++ tagged union |
| `src/jsc/DecodedJSValue.rs:13` `EncodedValueDescriptor` | JSValue tag bits | S | JSC `EncodedJSValue` convention; matches WebKit |
| `src/jsc/FFI.rs:28` `union_EncodedJSValue` | (same) | S | Generated bindings echo of JSC layout |
| `src/jsc/CallFrame.rs:209` `Register` / `:221` `EncodedValueDescriptor` | JSC tag | S | (same) |
| `src/jsc/JSObject.rs:261` `ExternColumnIdentifierValue` | enclosing enum tag | S | SQL identifier; matches C++ side |
| `src/sql_jsc/shared/SQLDataCell.rs:64` `Value` | `tag` field | S | Postgres/MySQL/SQLite shared cell — tag-checked in every read |
| `src/runtime/node/zlib/NativeBrotli.rs:12` `LastResult` | `mode` (encoder vs decoder) | S | All-zero `c_int 0 / enum 0` is a valid bit pattern (used by `Default::default()`) |
| `src/runtime/socket/SocketAddress.rs:899` `sockaddr` | `sa_family` | S | Mirrors POSIX `sockaddr` family-of-families |

**No "read different field after write" UB sites found among hand-rolled
unions.** Every active-field read is gated by either an enum tag, a kind
byte, or a tagged-pointer bit; tag-gating is documented for each in
PORTING.md or the type-level comment.

---

## 4. bytemuck / zerocopy candidacy scan

Of the 28 transmute sites, only a small subset is migrate-able. Function
pointers are **not** `bytemuck::Pod` (not zeroable), enum discriminants are
**not** `bytemuck::CheckedBitPattern` without a derive (and `bytemuck`'s
derive does not yet handle `#[repr(u16)]` enums with sparse discriminants),
and lifetime-only transmutes have no safe equivalent.

### Migrate-able to `bytemuck::checked::cast` (validity-checking enum cast):

| # | Site | Suggested fix |
| - | ---- | ------------- |
| 5  | `scanImportsAndExports.rs:1682` `u16 → PropertyIdTag` | derive `bytemuck::CheckedBitPattern` on `PropertyIdTag`; use `bytemuck::checked::try_cast` and `.expect()`/unwrap-or-panic. Removes one `unsafe`. |
| 17 | `c_ares.rs:2049` `i32 → Error` | derive `bytemuck::CheckedBitPattern` on `Error`; replace the assert + transmute with a single checked-cast that returns `Option<Error>`. |
| 19/20/21 | errno enums (`E`, `SystemErrno`) | already have `strum::FromRepr`-based `try_from_raw`; **delete `from_raw`'s unchecked `transmute` body** and have it delegate to `from_repr(n).expect(...)` / `try_from_raw(n).expect(...)`. Do not use `unreachable_unchecked` here: `from_raw` is currently safe, and EXP-097 proves release-mode safe callers can pass invalid tags. (Linux raw-syscall path remains EXP-002.) |

### Migrate-able to plain `as` cast or POD copy:

| # | Site | Suggested fix |
| - | ---- | ------------- |
| 25 | `linux_syscall.rs:209` `Stat → libc::stat` | derive `bytemuck::Pod` on both? — **rejected**: both come from external crates (`rustix`, `libc`). The source const-asserts size/align; Codex added an audit-only field-offset witness for x86_64/aarch64. Leave as-is, or optionally inline those offset asserts as hardening. |

### NOT migrate-able (irreducible `unsafe`):

- All fn-ptr transmutes (#3, #4, #6/#7, #9/#10, #13/#14, #18, #22, #23, #24): fn pointers are not `bytemuck::Pod`. Required for FFI vtable/dlsym typing.
- All lifetime-erasure transmutes (#1, #8, #11, #12, #15/#16): lifetimes have no Pod representation; sound iff the borrow is dropped before the backing storage. Each carries a documented SAFETY clause.
- `#26 BunLoader` is migrate-able to `bytemuck::CheckedBitPattern` **and the input width must be fixed** — see §5.

---

## 5. Registry mapping and hardening queue

| ID | Site | Class | Recommended action |
| -- | ---- | ----- | ------------------ |
| **EXP-051** | `packages/bun-native-plugin-rs/src/lib.rs:637` `BunLoader` read | U — validity (#4) + type-pun (#6) | `(*self.result_raw).loader` is a `u8`; the cast-to-u32-then-transmute is wrong twice: the source field is `u8` while the enum is `repr(u32)`, AND no validity check guards values `13..=255`. Phase-8 triangulation rejects a flag-day return-type swap; use the coexistence plan: keep `output_loader` as deprecated/unsafe and add `try_output_loader -> Result<BunLoader, InvalidLoader>`. |
| F-NF6-1 / EXP-064 vehicle | `scanImportsAndExports.rs:1682` `u16 → PropertyIdTag` | W / deferred hardening | Re-derive `PropertyIdTag` with `bytemuck::CheckedBitPattern`; replace transmute. Same checked-bit-pattern remediation vehicle as EXP-051, but no separate source-shaped witness was run for this exact enum. |
| F-NF6-2 | `perf/tracy.rs:710-726` & `:798` dlsym `transmute_copy` | H | Current monomorphisations are all `tracy_fns::*` unsafe extern fn pointers, so no live UB was proven. Hoist the runtime `debug_assert_eq!(size_of …)` into a compile-time typed-dlsym gate to match `sys::dlsym` / `fs_events::dlsym` and prevent future drift. |
| EXP-077 | `css/css_parser.rs:2718/2723` `'_ → 'static` widen | C | Re-type `ToCssResult` / `ToCssResultInternal` to carry the bump lifetime explicitly (TODO at line 2309 already calls this out), or deep-copy the CSS module export/reference maps into owned storage. Removes two transmutes and the confirmed safe-API dangling-reference shape. |
| EXP-002 (already filed) | errno transmutes (#19/#20/#21) | U (latent, Linux) / W (Windows) | Route `from_raw`/`init` through `from_repr`; replace `impl GetErrno for usize` raw transmute with `SystemErrno::init` (the checked variant already exists). |

---

## 6. Sound / unsound breakdown

| Verdict | Count | Sites |
| ------- | ----- | ----- |
| **S** (sound) | 17 | 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 17, 18, 22, 23, 24, 25, (plus 28 hand-rolled unions) |
| **W** (weak — caller-contract dependent, no static enforcement) | 6 | 4, 5, 13, 14, 15, 16 |
| **L** (latent — `pub` but unreachable today) | 0 distinct (subsumed in #19) | — |
| **U** (unsound on documented inputs / safe API boundary) | 4 | 19 (EXP-002), 20/21 (EXP-097), 26 (EXP-051) |

Two of the eight **W** sites (#15, #16) are the CSS module exports
lifetime-laundering pair — sound by current callers but the wrong shape;
EXP-077 fixes both.

---

## 7. Cross-references

- EXP-002 — `linux_errno` `u16 → SystemErrno` — **CONFIRMED** miri UB witness at `.unsafe-audit/verification/miri-confirmed-linux-errno-transmute.md`; **latent** in current source (no live caller routes through `impl GetErrno for usize`).
- EXP-004 — `encoding.rs Vec<u8> → Vec<u16>` — out of bucket 6 (covered in bucket 20, alloc pairing), but is fundamentally a type-pun (`Vec<u8>` reused as `Vec<u16>` storage). Mentioned for completeness.
- Phase 1 inventory R "Lifetime-stretch transmute cluster" — overlaps with sites 1, 8, 11, 12, 15, 16 here.
- Phase 1 inventory T `libuv` section — sites 2, 3, 4 cited there.
- Phase 1 inventory J — `image/backend_wic.rs` (site 23) and `ffi/FFIObject.rs` (site 22).
- Phase 1 inventory U — `perf/tracy.rs` dlsym (sites 13, 14).

---

## 8. Top 3 candidates for bytemuck / zerocopy migration

1. **`BunLoader` read in `bun-native-plugin-rs` (#26)** — change `#[repr(u32)]` → `#[repr(u8)]` matching the C field width, derive `bytemuck::CheckedBitPattern`, replace the double-cast transmute with `bytemuck::checked::try_cast`. Eliminates a real UB on hostile-host input on a public API surface. **Highest impact.**
2. **`E` / `SystemErrno` errno reads (#19/#20/#21)** — `strum::FromRepr` already exists; replace every `from_raw`/`init` `transmute` body with the checked path and demote `from_raw` to debug-only. Closes EXP-002 outright and tightens Windows.
3. **`PropertyIdTag` (#5) + `c_ares::Error` (#17)** — both `#[repr(u16)]` / `#[repr(i32)]` with fixed discriminants; both already paired with an assert that exists to defend the transmute. `bytemuck::CheckedBitPattern` derive makes the assert structural.
