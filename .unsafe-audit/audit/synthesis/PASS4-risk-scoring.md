# Pass 4 — Risk Scoring of Current T1 Findings

**Date:** 2026-05-15
**Methodology:** `rust-unsafe-code-exorcist` RISK-SCORING.md (skill-local methodology; not committed into this repository).
**Input:** Pass 2 T1 list (Codex-confirmed) + Pass 3 T1 list (post-Codex demotions, per [`CODEX_PASS3_FINAL_REVIEW.md`](../../CODEX_PASS3_FINAL_REVIEW.md)) + Pass 4 additions from parser, threading, and crash-handler audits.
**Output of this document:** a quantified prioritization of every current T1, plus aggregates by crate and a pre-/post-Codex comparison.

Formula: `RISK_SCORE = BLAST_RADIUS × LIKELIHOOD × DISCOVERABILITY`, each axis 1-5, product range 1-125. Tier mapping per the skill: 60-125 = P0 critical, 25-59 = P1 high, 10-24 = P2 medium, 1-9 = P3 low.

Bun-specific calibration:
- **BLAST 5** = every `bun install` / `bun serve` user (system-level, JS reachability is universal: 99.5% of unsafe is JS-reachable per Pass 3 reachability synthesis).
- **BLAST 4** = JS-API-reachable but constrained to runtime/web APIs.
- **BLAST 3** = build-tool only (bundler, transpiler) — reachable via every `bun build`.
- **BLAST 2** = CLI-only paths.
- **BLAST 1** = internal helpers; reachable only through specific call shapes.
- **LIKELIHOOD 5** = already flagged by miri/loom/fuzz, or by a Codex/reviewer adversarial pass that confirmed live UB.
- **LIKELIHOOD 4** = no SAFETY comment AND call graph changed (post-port-commit `23427db`, every unsafe in this audit is post-23427db, so age alone is not a signal — use this when the site is brand-new from the Zig translation gap and the SAFETY block lies or is missing).
- **LIKELIHOOD 3** = stale or missing SAFETY comment.
- **LIKELIHOOD 2** = SAFETY comment exists but Codex's adversarial review demoted the original confidence (i.e., contract-defect, not active UB).
- **LIKELIHOOD 1** = SAFETY comment recent, reviewed, no demotion path.
- **DISCOVERABILITY 5** = pub API on a popular fn, untrusted input, no fuzz target. For Bun: `PUB-INSTALL-*` (every `bun install` on a malicious repo), `H9` (every inbound HTTP request).
- **DISCOVERABILITY 4** = pub API, `&[u8]`/`&str` input, fuzz target exists or is straightforward to add.
- **DISCOVERABILITY 3** = pub API, constrained-type input.
- **DISCOVERABILITY 2** = feature-flag-gated or platform-gated.
- **DISCOVERABILITY 1** = internal helper, constrained inputs.

## Headline T1 count after Codex demotions

| Cohort | T1 entries |
|--------|-----------:|
| Pass 1 confirmed | 2 |
| Pass 2 confirmed (Codex-respected) | 14 |
| Pass 3/4 corrected additions after Codex demotions and de-duplication | ~24 |
| **Total current T1/T1-equivalent dashboard entries** | **40** |

Pre-Codex Pass-3 raw total was 39 T1 + 4 P0 (43) on top of Pass-2's 18, i.e., ~63 — that is the number this artifact intentionally does **not** publish. Codex's pass-3 final review demoted `H3`, `UvHandle::close`, the 4 JSC `pass3-ub-*` items, `pending_tasks`, `ThreadSafeRefCount::ref_`, `FetchTasklet::abort_task`, WebSocket deflate H3 headline framing, `bun_libarchive_sys` orphan, `WeakPtrData`, `JsCell<T>`, and `RacyCell<T>` from T1 to T2/T3 or repo hygiene. Pass 4 then adds two semver lockfile P0s plus `GuardedLock`'s missing `!Send` marker. The list below reflects that corrected tiering.

---

## Tier-1 risk scores (per finding)

| ID | Location | BLAST | LIKE | DISC | Risk | Tier | Notes |
|----|----------|------:|-----:|-----:|-----:|-----:|-------|
| PUB-INSTALL-1 | `install/lockfile/Package.rs:3320-3478` `Meta::has_install_script` | 5 | 5 | 5 | **125** | P0 | Niche-violating `transmute<u8, HasInstallScript>`; reaches UB on every `bun install` over an attacker-planted `bun.lockb`. Codex final review keeps this as the strongest finding. |
| PUB-INSTALL-2 | `install/lib.rs:1128` `Meta::origin` | 5 | 5 | 5 | **125** | P0 | Same niche-violating shape on `Origin` enum; same trigger surface. |
| PUB-INSTALL-3 | `install/yarn.rs:918-925` | 5 | 5 | 5 | **125** | P0 | `&mut [Dependency]` over uninitialised Vec capacity where `Dependency` embeds the closed `#[repr(u8)] DependencyVersionTag` enum. Codex confirms it is not an "all bytes valid" buffer. |
| PUB-INSTALL-4 | `install/lockfile/Tree.rs:1020` | 5 | 5 | 5 | **125** | P0 | Attacker-controlled dependency ID feeds `deps.get_unchecked(dep_id as usize)`. Per Codex correction: "attacker-controlled dependency ID, not 'dep_id byte'." |
| F-NEW-1 | `semver/lib.rs:586-614` `String::slice` | 5 | 5 | 5 | **125** | P0 | `bun.lockb` bytes can populate a long-form `SemverString` with arbitrary `(off, len)`; `slice()` trusts that pair and calls `get_unchecked(off..off+len)`. Attacker-controlled lockfile → out-of-bounds slice/read. |
| F-NEW-2 | `semver/lib.rs:520-539` `String::eql` | 5 | 5 | 5 | **125** | P0 | Same packed-string trust bug in equality: two unchecked `(off, len)` windows can be read while comparing package/dependency names and versions from a malicious lockfile. |
| H9 | `vendor-shim picohttp/lib.rs:383` | 5 | 5 | 5 | **125** | P0 | Writes NUL through `cast_mut()` of a `&[u8]`-derived pointer on every inbound HTTP/1.1 request and fetch response. SB-UB confirmed; current behaviour happens to work because BoringSSL/uWS gives a buffer the parser is allowed to mutate, but the Rust borrow proves shared, so the write is UB at the language level. |
| PUB-INSTALL-5 | `install/lockfile/Lockfile.rs read_array<T>` | 5 | 4 | 4 | **80** | P0 | Alignment of `Vec<u8>` base + `start_pos % align_of::<T>() == 0` is not sufficient under Rust's alignment rules. High-confidence per Codex final ("high-confidence P1s"). |
| PUB-INSTALL-6 | sibling `read_array<T>` call site in Lockfile parse | 5 | 4 | 4 | **80** | P0 | Same shape as -5. |
| H5 | `http/lib.rs:631,2218` | 5 | 4 | 4 | **80** | P0 | `request_content_len_buf: [u8; 11]` overflows on `body_len >= 10^11`, silently emits `Content-Length: 0` while body bytes are still written. Request-smuggling primitive against any HTTP proxy in front of Bun. |
| PUB-INSTALL-7 | `install/lockfile/Package.rs` per-column load `set_len` | 5 | 4 | 3 | **60** | P0 | `set_len` before per-column load is dangerous because the error/drop path can observe partially initialised list rows. Codex final says: "set_len before per-column load is dangerous." |
| bundler-B1 | `bundler/Chunk.rs:130-132` Renamer borrow cascade | 3 | 5 | 4 | **60** | P0 | N parallel `&mut`'s to one `Renamer` pointee. `SymbolMap::follow()` does path compression through `Cell<Ref>` (Codex correction), so this is not benign read-only access. Triggered by every `bun build` of a multi-chunk project. |
| bundler-B2 | `bundler/LinkerContext.rs:1657` `LinkerContext::c` | 3 | 5 | 4 | **60** | P0 | `&mut LinkerContext` materialised N ways across `generate_chunk` fan-out. Same UB shape as B-1. |
| bundler-B3 | `bundler/generateCompileResultForJSChunk.rs:61-62` | 3 | 5 | 4 | **60** | P0 | `&mut LinkerContext` and `&mut Chunk` aliased N ways during JS chunk fan-out. |
| bundler-B4 | `bundler/generateCompileResultForCssChunk.rs:45-46` | 3 | 5 | 4 | **60** | P0 | Same shape for CSS chunks. |
| bundler-B5 | `bundler/prepareCssAstsForChunk.rs:77-78` | 3 | 5 | 3 | **45** | P1 | `&mut LinkerContext` aliased N ways during CSS-AST prep fan-out. Chunk reborrow is fine because each CSS chunk has at most one task (verified upstream). Lower DISC than B-1..B-4 because CSS path is less broadly exercised. |
| P3-BC-001 | `bun_core/fmt.rs:725-731` `fmt::Raw` / `fmt::s` / `fmt::raw` | 5 | 4 | 4 | **80** | P0 | Safe `Display` runs `from_utf8_unchecked` on caller bytes. Reachable via `argv[0]`, tarball paths, tmpname formatting — all of which carry non-UTF-8 bytes on real systems. Library UB on `&str` validity. |
| P3-BC-002 | `bun_core/string/StringBuilder.rs:315-332` `move_to_slice` | 5 | 4 | 3 | **60** | P0 | Returns `Box<[u8]>` with length = full `cap` but only `len` bytes init. Tail read is deferred UB; caller cannot fix without `unsafe { set_len }` they aren't told to write. |
| P3-BC-003 | `bun_core/bounded_array.rs:108-114` `BoundedArray::resize` | 5 | 4 | 3 | **60** | P0 | Safe `resize(len)` grows logical length over `[MaybeUninit<T>]` storage without init; subsequent `const_slice`/`get`/`pop` reads uninit `T`. Niche-bearing `T` (NonNull, &_, bool, char) is immediate reference UB. |
| P3-BC-004 | `bun_core/string/MutableString.rs:416-420` `to_owned_slice_length` | 5 | 4 | 3 | **60** | P0 | `set_len(length)` unconditional; any value > `len` exposes uninit, > capacity is OOB. SAFETY comment exists but obligation lives only in the comment. |
| P3-BC-005 | `bun_core/string/MutableString.rs:311-320` `inflate` | 5 | 4 | 3 | **60** | P0 | `reserves + set_len(amount)` leaves new tail uninit (Zig parity), then `slice(&mut self) -> &mut [u8]` exposes uninit bytes to any reader. |
| pre-existing-ub-002 | `bun_ast/nodes.rs:339-340` `unsafe impl<T> Send/Sync for StoreSlice<T>` | 4 | 5 | 4 | **80** | P0 | Sister `StoreRef<T>` correctly bounds `T: Send`/`Sync`. `StoreSlice<T>` is unbounded. Launders `Cell<u32>` etc. across thread boundaries. Codex pass-2 confirmed as the strongest standalone-PR finding. |
| TH-1 | `threading/guarded.rs:132-134` `GuardedLock<'_, V, Mutex>` | 3 | 5 | 2 | **30** | P1 | Safe guard object auto-derives `Send`, so safe Rust can move it to another thread and run `Drop::drop` there, calling `Mutex::unlock()` from the wrong thread. Sibling `MutexGuard` already uses `PhantomData<*const Mutex>` to block this. |
| pre-existing-ub-001 | `errno/linux_errno.rs:175-188` | 2 | 4 | 2 | **16** | P2 | `transmute<usize, SystemErrno>` with kernel range claim wider than the enum's `0..=133`. Latent: callers are currently disciplined; demoted DISC because the path is internal-only today. Still T1 because the public impl is a loaded trap. |
| UB-RT-001 | `runtime/webcore/encoding.rs:303-310` | 4 | 4 | 3 | **48** | P1 | `Vec<u8>` -> `Vec<u16>` via `Vec::from_raw_parts`, violating allocator layout and alignment. Reachable via `TextDecoder`/`TextEncoder`. Source TODO already flags it. |
| U1 | `install/pack_command.rs:3009` | 3 | 4 | 3 | **36** | P1 | `&mut T` from `from_ref(...).cast_mut()`. SB/TB UB; fix is threading a true mutable owner through `bun pack`. |
| U2.×8 | 8 sites: `http/AsyncHTTP.rs:117`, `http/lib.rs:176`, `node_fs.rs:2397`, `bun_alloc/lib.rs:3267`, `bun_core/string/mod.rs:1765`, `jsc/lib.rs:2022` (was `:2013` pre-`fe2635b460` cargo fmt; Pass-5 accuracy sweep), `jsc/ZigString.rs:70`, `jsc/ZigString.rs:102` | 4 | 4 | 3 | **48** | P1 | Dealloc/`heap::destroy`/`mi_free` through `*mut T` derived from `from_ref(slice).cast_mut()`. SB-UB on the dealloc path; canonical Zig translation gap. Counted as one entry for risk-scoring since the fix is uniform; per-site risk is 48. |
| pre-existing-ub-ptr-1 | `standalone_graph::slice_to[_mut/_z]` | 3 | 4 | 2 | **24** | P2 | `from_raw_parts[_mut]` after `debug_assert!`-only bounds checks. Tampered standalone artifact → OOB slice. DISC 2 because standalone-binary mode is opt-in via `bun build --compile`. |
| pre-existing-ub-ptr-2 | `bun_core::Unaligned::slice_align_cast[_mut]` | 4 | 4 | 4 | **64** | P0 | `debug_assert!`-only alignment check, then forms `&[T]`/`&mut [T]`. JS `ArrayBuffer` helpers are representative callers — any release caller with unaligned bytes creates immediate reference UB. Re-flagged P3-BC-207. |
| pre-existing-ub-ptr-3 | `bun_io::Request::store_callback_seq_cst` | 4 | 3 | 2 | **24** | P2 | `write_volatile` + `SeqCst` fence used as cross-thread publish primitive. Volatile is not atomic; needs `AtomicPtr`/`AtomicUsize` with Release/Acquire. Latent ordering bug; current call graph happens to converge. |
| pre-existing-ub-ptr-4 | `sys/lib.rs:9130` `SysQuietWriterAdapter::adapter_write_all` | 4 | 4 | 3 | **48** | P1 | `this.pos + bytes.len()` overflow → bypasses capacity check → `copy_nonoverlapping` past buffer. Reachable from any high-volume log writer or test harness. |
| pre-existing-ub-ptr-5 | `bun_shim_impl.rs:1244` (Windows shim) | 3 | 4 | 2 | **24** | P2 | `ptr::copy(src, dst, len+1)` guarded by `debug_assert!` only. Release builds need a real bound check. Windows-only DISC. |
| pre-existing-ub-ptr-6 | `sourcemap/SerializedSourceMap::header()` | 3 | 4 | 3 | **36** | P1 | Public/sibling accessors call `header()` before checking `bytes.len() >= size_of::<Header>()`. A truncated map → OOB read via `read_unaligned`. Reachable from `bun --inspect`, `BUN_PROFILE`, and sourcemap-emitting bundler runs. |
| pre-existing-ub-9 | `runtime/ffi/ffi_body.rs:1351-1370` `FFI.close()` UAF | 4 | 5 | 3 | **60** | P0 | Frees TinyCC/JIT state while JS-visible `JSFFIFunction` wrappers retain callable trampolines. Calling a stashed function after close jumps into freed code. Reachable to any JS user of `bun:ffi` who calls `close()`. |
| pre-existing-ub-10 | `runtime/ffi/ffi_body.rs:1281-1285` exported from `FFIObject.rs` | 4 | 5 | 4 | **80** | P0 | `closeCallback(ctx)` accepts a JS-supplied address and runs `heap::take` with no membership check. Wrong address or double-close → arbitrary free / double free. Treated as out-of-contract for bun:ffi but currently exported to JS. |
| F-1 / pre-existing-ub-13 | `bun_collections/linear_fifo::assume_init_slice{,_mut}` | 3 | 5 | 3 | **45** | P1 | Reinterprets `[MaybeUninit<T>]` as `[T]`. Active niche-bearing users: `LinearFifo<RefDataValue, _>` in test runner; Valkey queue payloads with `Box`/`Strong`-like fields. Compile witness `verification/repro-linear-fifo-niche.rs` proves the cast permits invalid bit patterns. |
| sys-T1-2 (macOS) | `sys/lib.rs:498` macOS dirent arm | 2 | 4 | 2 | **16** | P2 | Zero-`namlen` edge case → `Name::borrow` one-past-end deref. Triggered by adversarial/malformed dirent stream on macOS only. |
| sys-T1-3 (Linux) | `sys/lib.rs:373` Linux `getdents64` | 2 | 4 | 2 | **16** | P2 | Panics in release if kernel emits `reclen < 19`. Defensive guard missing. Reachable from `node:fs.readdir` against an exotic filesystem. |
| sys-T1-4 | `sys/lib.rs:6488,:6556`, `windows/mod.rs:3801` (3-site group) | 2 | 4 | 2 | **16** | P2 | `UNICODE_STRING::Buffer: *mut u16` from `&[u16]` slices — provenance footgun. Windows-only DISC. |
| uws-libuv-F2 | `libuv.rs:437-460` `Loop::shutdown` | 2 | 4 | 2 | **16** | P2 | `debug_assert_eq!` for second-close check, but Zig's `bun.debugAssert` evaluates in release. Port-introduced regression: silently leaks handles in release builds. Availability bug technically, but mis-counted because the underlying `uv_close` invariant is genuinely a memory-safety obligation (closing twice corrupts libuv's handle list). |

---

## Aggregates

### Top 10 by risk score

| Rank | ID | Risk | Tier | Cluster |
|-----:|----|-----:|-----:|---------|
| 1 (tie) | PUB-INSTALL-1 | 125 | P0 | bun_install |
| 1 (tie) | PUB-INSTALL-2 | 125 | P0 | bun_install |
| 1 (tie) | PUB-INSTALL-3 | 125 | P0 | bun_install |
| 1 (tie) | PUB-INSTALL-4 | 125 | P0 | bun_install |
| 1 (tie) | F-NEW-1 | 125 | P0 | bun_semver / lockfile |
| 1 (tie) | F-NEW-2 | 125 | P0 | bun_semver / lockfile |
| 1 (tie) | H9 | 125 | P0 | bun_http |
| 8 (tie) | pre-existing-ub-002 (StoreSlice<T>) | 80 | P0 | bun_ast |
| 8 (tie) | PUB-INSTALL-5 | 80 | P0 | bun_install |
| 8 (tie) | PUB-INSTALL-6 | 80 | P0 | bun_install |
| 8 (tie) | H5 | 80 | P0 | bun_http |
| 8 (tie) | pre-existing-ub-10 (FFI closeCallback) | 80 | P0 | bun_runtime (ffi) |
| 8 (tie) | P3-BC-001 (fmt::Raw UTF-8) | 80 | P0 | bun_core |

Thirteen entries sit at risk ≥ 80, dominated by the lockfile/install P0s, the semver packed-string P0s, and the HTTP NUL-write. Every entry at 125 is an attacker-input → UB chain with no fuzz target and no constrained-type filter — i.e., the worst quadrant of the rubric.

### P0/P1/P2 distribution (current T1 dashboard only)

| Risk band | Entries | Cumulative coverage of T1 risk-points |
|-----------|--------:|--------------------------------------:|
| 60-125 (P0) | 24 | 2,019 of 2,507 = **81%** |
| 25-59 (P1) | 8 | 336 of 2,507 = **13%** |
| 10-24 (P2) | 8 | 152 of 2,507 = 6% |
| Total | 40 | 2,507 |

The top 24 dashboard entries carry roughly four-fifths of the audit's quantified soundness/security debt. This matches the canonical RISK-SCORING.md guidance: "highest-risk sites: maximum-leverage refactor batch; spend most of the audit's refactor budget on them."

### Sum of risk-points per crate

| Crate / owner | T1 entries/sites | Risk-points |
|---------------|----------------:|------------:|
| `bun_install` | 8 | **756** |
| `bun_semver` (packed lockfile strings) | 2 | **250** |
| `bun_http` (incl. picohttp shim) | 2 | **205** |
| `bun_core` (string, fmt, BoundedArray, MutableString, Unaligned) | 6 | **388** |
| `bun_bundler` | 5 | **285** |
| `bun_runtime` (encoding, ffi_body, FFIObject) | 3 | **188** |
| `bun_ast` (StoreSlice<T>) | 1 | 80 |
| Multi-crate U2 dealloc/free-through-shared-provenance group | 8 | 48 |
| `bun_threading` (`GuardedLock`) | 1 | 30 |
| `bun_jsc` (U2 sites in jsc/lib.rs and ZigString; JsCell moved to T2) | 3 | subset of U2 group |
| `bun_alloc` (U2 site at lib.rs:3267) | 1 | subset of U2 group |
| `bun_sys` (writer overflow, dirent variants) | 4 | 96 |
| `bun_io` (Request publish) | 1 | 24 |
| `bun_collections` (linear_fifo) | 1 | 45 |
| `bun_libuv_sys` (Loop::shutdown) | 1 | 16 |
| `bun_errno` (Linux SystemErrno) | 1 | 16 |
| `bun_shim_impl` (Windows) | 1 | 24 |
| `bun_sourcemap` | 1 | 36 |
| `bun_standalone_graph` | 1 | 24 |

(Counts in `bun_jsc`/`bun_alloc` overlap with the U2.×8 group so the total per-crate sum is not the simple addition; the U2.×8 group is counted once at 48 risk-points across its 8 sites in the per-finding table above.)

The lockfile/install pipeline (`bun_install` + `bun_semver`) now carries **1,006 risk-points** across 10 dashboard entries, or **40% of all current risk**. This is the first same-day source-fix target.

### Pre-Codex vs post-Codex totals

| Metric | Pre-Codex Pass 3 raw | Post-Codex final |
|--------|---------------------:|-----------------:|
| T1 count | ~63 (39 + 4 P0 + 18 Pass 2 + 2 Pass 1 with overlap) | **40** |
| Pre-Codex over-claim | — | 18 entries demoted to T2/T3 or repo hygiene |
| Risk-points (T1/T1-equivalent dashboard only) | ~3,100 (estimate including the demoted entries scored at their original tier) | 2,507 |
| P0 (>=60) count | 31 estimated | 24 |
| Marketable security-triage entries | The early Pass 3 plan text used "CVE-class"; Codex constrains that phrase to cases whose exploit story survives maintainer review | PUB-INSTALL-1..4 are confirmed in the Pass-3 supply-chain set; H9 is network-input-reachable and is the strongest non-install P0; F-NEW-1/F-NEW-2 are the Pass-4 supply-chain additions |

What changed mechanically:

- **`H3` WebSocket deflate** demoted from T1 ("5-byte → 4 GiB OOM") to T2 bounded-memory-amplification hardening. Risk-points removed: ~64 estimated. Per Codex: `decompress_to_vec` writes only into existing spare capacity, and the zlib fallback checks size after each growth chunk. Not an unbounded 4 GiB pre-check allocation primitive.
- **`UvHandle::close` function-pointer transmute** demoted to portability/SAFETY-comment hardening (T3). Per Codex: not a variadic ABI mismatch on any supported Bun target. Risk-points removed: ~36.
- **JSC `pass3-ub-*` items (4)** demoted to T2 (`JsRef::Weak`, blanket task `Send`, `Blob: Send+Sync`, `VirtualMachine: Send+Sync`). Architecture defects without a demonstrated production UB path. Risk-points removed: ~144 estimated.
- **`pending_tasks` ordering** demoted to T3. Per Codex: source mirrors Zig's monotonic increment/release decrement/acquire load; queue state is mutex-protected; counter is a completion metric. Risk-points removed: ~36.
- **`ThreadSafeRefCount::ref_` revival** demoted unless a bad caller is shown. Per Codex: `ref_` is unsafe and requires a live `T`; revival race exists only at call sites that can call `ref_` from a raw pointer without proving a live reference. Add `try_ref` hardening; do not count primitive itself. Risk-points removed: ~48.
- **`FetchTasklet::abort_task` Relaxed flag** demoted. Per Codex: Relaxed is sufficient for a standalone cancellation flag if no non-atomic payload is published through it. The artifact did not show such a payload. Risk-points removed: ~36.
- **install pipeline (5 sites) cross-T1-3 monotonic increment** demoted to ordering-policy cleanup. Per Codex: mirrors Zig pattern; queue state is mutex-protected. Risk-points removed: ~48 estimated.
- **`bun_libarchive_sys` orphan** demoted to stale-crate hygiene. Not a memory-safety finding. Risk-points: removed entirely (~0 contribution to T1 sum because it had no exploitable path).

The pre-Codex framing inflated the T1 count by mixing safe-API contract defects (real, but T2) with confirmed UB bugs (T1). This artifact restores the separation.

---

## Per-finding defensibility notes

### Why PUB-INSTALL-1..4 are all BLAST=5, LIKE=5, DISC=5

These are the worst-quadrant supply-chain primitives. Every `bun install` over an attacker-planted `bun.lockb` or `yarn.lock` is a trigger. The Zig original used `@enumFromInt`, which panics on invalid discriminants in safe build modes; the Rust port faithfully reproduced the syntax but `transmute<u8, Enum>` is unconditionally UB. The Codex final review confirms the mechanism is exactly as described. No fuzz target exists. The behaviour is reachable from `bun install <repo>`, `bun add`, `bun update`, and the CI install path. LIKE=5 is justified by Codex's adversarial confirmation, which functions as the "already flagged by adversarial review" anchor in the LIKELIHOOD rubric.

### Why H9 is also at 125

Every inbound HTTP/1.1 request to `Bun.serve` and every inbound fetch response goes through `picohttp::Request::parse`. The parser writes a NUL terminator through `cast_mut()` of a pointer derived from `&[u8]`. Under Stacked Borrows, this is UB regardless of whether the underlying buffer is "really" mutable. Codex final keeps this as a strong finding ("fix by requiring mutable input or an owning mutable buffer"). The fix is local (~5 lines per Pass 3 PR landing order). LIKE=5 is justified because the parser is on the hot path and any non-trivial workload exercises it billions of times.

### Why bundler-B1..B4 are BLAST=3, not BLAST=5

The bundler runs at `bun build` time. The `bun build` command is reachable but is not as universal as `bun install` (which is on every `bun add`, `bun create`, `bun pm install`, and the test-runner's implicit fetch path). BLAST=3 reflects the build-tool-only scope. Within the build-tool scope, B-1..B-4 are still on the hot path of every multi-chunk build, so DISC=4 stays high. Codex final promoted these from watchlist to confirmed UB, fixing a Pass-2 framing error.

### Why P3-BC-001 (fmt::Raw UTF-8) is BLAST=5

`fmt::Raw` / `fmt::s` / `fmt::raw` are safe `Display` adapters used throughout the runtime to format log lines, error messages, and CLI output. Every `bun` invocation that emits a path containing non-UTF-8 bytes (which happens on Linux filesystems regularly) hits this path. The library UB is on `&str` validity — creating an invalid `&str` is UB even if it is never read further. BLAST=5 is justified by JS-reachability (the Pass-3 reachability synthesis confirms 99.5% of unsafe is JS-reachable through `bun_runtime`).

### Why P3-BC-002..005 are DISC=3, not DISC=5

These are safe APIs reachable from any caller, but they require specific call sequences (`move_to_slice` then read tail; `inflate` then `slice`). DISC=3 reflects that callers must form the specific pattern — most current call sites do not. The risk-point still lands them at P0 because BLAST and LIKE are high.

### Why pre-existing-ub-001 (Linux SystemErrno) is BLAST=2

The `usize -> SystemErrno` transmute is dead in the current call graph. The only caller is `impl GetErrno for usize` which is itself not invoked from any release path today. The latent trap is real (Codex pass 2 confirmed it as latent), but the BLAST is "internal-only until a future caller wires it in." This is the textbook case where LIKE=4 (call graph could change) keeps the entry at T1 but DISC=2 caps the risk at 16.

### Why pre-existing-ub-9 and -10 (bun:ffi) are NOT separated as "intentional FFI hazard"

Pass 2 separated `bun:ffi`'s raw-pointer capability contract (`toArrayBuffer`, `toBuffer`, `toCStringBuffer`, finalizer function pointers) from Bun's own lifetime bugs. The FFI capability contract is documented as privileged-by-design; user provides addresses; Bun does not promise validity. But `FFI.close` and `closeCallback` are *Bun's* lifecycle code, not the user-provided pointer surface — closing the JIT state while JS wrappers retain callable trampolines is a Bun bug, not a user contract violation. These are T1 with BLAST=4 because `bun:ffi` is a public surface but constrained to opt-in users.

### Why U2.×8 is one row at risk=48, not eight rows

The U2 group is 8 source sites with identical UB shape (`from_ref(slice).cast_mut()` → dealloc through SharedReadOnly provenance). The fix is the same one-pattern mechanical replacement at each site. For prioritization, treating the group as one risk-48 entry is appropriate because an engineer landing the fix lands all 8 sites in one PR. The per-site risk is still 48; aggregating risk-points by crate, the group contributes 48 once to `bun_http`, once to `bun_runtime`, once to `bun_alloc`, once to `bun_core`, once to `bun_jsc` (twice), etc. — accountancy for per-crate heat-map is the eight sites; for prioritization it is one fix.

---

## Calibration sanity check

The top of the list (5 sites at risk=125) matches human intuition: an attacker-planted lockfile that triggers UB at install time is the worst thing this audit found, and the audit team's own ordering of "PR landing priority" puts the 4 install P0s first.

The bottom of the list (sys-T1-2/3/4 at risk=16) matches intuition the other way: these are real bugs, but they need a malicious filesystem or exotic kernel to trigger, on a platform-specific path, with no untrusted-input pipeline behind them.

Where the audit might disagree with this scoring:

- **B5 (bundler CSS-AST prep) at risk 45 vs B1..B4 at risk 60** — the difference is DISC=3 vs DISC=4. The CSS path is genuinely less exercised than the JS path on real Bun deployments, so DISC=3 is justified. A reviewer might argue B5 is morally identical to B-1..B-4 and bump it to risk 60. We accept the spread because the user instruction was "be defensible," and "less DISC because CSS path is less broadly exercised" is defensible.
- **pre-existing-ub-002 (StoreSlice<T>) at risk 80** — Codex pass 2 calls this "the strongest finding." A reviewer might bump LIKE to 5 (it's already flagged by adversarial review). We keep LIKE=4 because the demo failure case (`StoreSlice<Cell<u32>>` Send laundering) is a compile-time witness, not an observed live UB at any current call site. The 80 score is right for "design-defect, fix-mechanically" rather than "active UB exploit."
- **H5 at risk 80** — Strictly, this is a request-smuggling/security P0 rather than Rust memory-UB: the fixed `[u8; 11]` buffer causes malformed `Content-Length`, not an out-of-bounds Rust write. It stays in this dashboard as a clearly marked T1-equivalent security item because it is patchable, externally reachable, and shares the same remediation queue. Do not cite it as a memory-safety CVE without that qualifier.

---

## How this drives Pass-4 PR ordering

The skill's PR-landing recommendation maps directly to the risk-score ordering:

1. **Risk 125 cluster (7 sites)** — first PR set. PUB-INSTALL-1..4 are mechanical (`transmute<u8, Enum>` → `match`/`TryFrom`, ~20 lines each). F-NEW-1/2 add checked accessors for semver packed strings loaded from `bun.lockb`. H9 is ~5 lines (replace `cast_mut()` through shared slice with mutable-buffer / owning-Vec).
2. **Risk 80/64/30 cluster (8 sites)** — second PR set. StoreSlice<T> bounds (2 lines). PUB-INSTALL-5/6 alignment (require `Vec<T>` directly or use `read_unaligned`). H5 buffer sizing (`[u8; 21]`). pre-existing-ub-10 closeCallback membership check. P3-BC-001 fmt::Raw to `from_utf8_lossy`. `Unaligned::slice_align_cast` runtime guard. TH-1 `GuardedLock` `!Send` marker.
3. **Risk 60 cluster (11 sites)** — third PR set. Bundler B-1..B-4 (uniform fix: `*mut LinkerContext` + raw-pointer worker discipline + `follow_all()` proof). P3-BC-002..005 string-builder uninit-tail fixes. pre-existing-ub-9 FFI UAF (invalidate wrappers on `FFI.close`).
4. **Risk 45-48 cluster (9 sites)** — fourth PR set. U2.×8 batch. UB-RT-001 encoding Vec roundtrip. F-1 linear_fifo. pre-existing-ub-ptr-4 SysQuietWriterAdapter overflow. (JsCell<T>, RacyCell<T>, and WeakPtrData are now Tier 2 per Codex; they should be addressed in the T2 contract-defect tranche, not here.)
5. **Risk 16-36 cluster (10 sites)** — fifth PR set. Smaller hardening: Linux SystemErrno checked conversion, sys dirent variants, Windows shim metadata bound check, sourcemap header guard, standalone_graph release bounds, libuv Loop::shutdown release assert, U1 pack_command.

The first three PR sets cover most quantified T1 risk and the highest-blast-radius attack surface. The remaining sets are valuable but not blocking for any reasonable release-gate definition.

---

## Defensibility of specific Codex-driven demotions

To make this risk table defensible against the reviewer who asks "why is X not on this list," here is the demotion log with source-evidence.

### H3 WebSocket deflate

**Pre-Codex score:** BLAST 5 × LIKE 5 × DISC 4 = 100. (Network-remote, no fuzz, untrusted input via `permessage-deflate` extension.)
**Post-Codex demotion:** T2 hardening; risk-points removed from T1 sum.
**Source evidence:** `decompress_to_vec` writes only into existing spare capacity. The zlib fallback checks size after each growth chunk. The 128 MiB cap is bounded above by Bun's existing limit. Codex final review confirms: "This may still be a bounded memory-amplification hardening item, but it is not the claimed unbounded 4 GiB allocation primitive."
**Tracked as:** WebSocket deflate hardening item; permessage-deflate amplification analysis recommended but not required.

### UvHandle::close function-pointer transmute

**Pre-Codex score:** BLAST 4 × LIKE 4 × DISC 2 = 32. (Internal helper but in libuv, with platform-specific variadic ABI concern.)
**Post-Codex demotion:** T3 portability comment.
**Source evidence:** The function pointer is not variadic in the C-API sense; all currently supported Bun targets (Linux x64, Linux aarch64, macOS x64, macOS aarch64, Windows x64) pass both argument pointer types identically. The missing obligation is a documented "supported targets" comment, not a transmute fix.
**Tracked as:** UvHandle SAFETY comment + supported-targets documentation.

### JSC `pass3-ub-*` items (4 items)

**Pre-Codex score range:** BLAST 4 × LIKE 4 × DISC 3 = 48 (each).
**Post-Codex demotion:** T2 unsafe-contract defects.
**Source evidence:** `JsRef::Weak`, blanket task `Send`, `Blob: Send+Sync`, and `VirtualMachine: Send+Sync` are serious architecture defects, but the audit did not show a concrete current call path that triggers UB. Codex final: "future-proofing hazards rather than demonstrated production UB."
**Tracked as:** Tier-2 architecture defects with refactor plans in `audit/plans/CODEX-P3-*`.

### `ThreadSafeRefCount::ref_` revival race

**Pre-Codex score:** BLAST 4 × LIKE 4 × DISC 3 = 48.
**Post-Codex demotion:** T2 hardening (add `try_ref`); not counted as confirmed bug.
**Source evidence:** `ref_` is `unsafe fn` and requires a live `T`. A revival race exists only at call sites that can call `ref_` from a raw pointer without already owning or proving a live reference. The audit did not enumerate such callers. Codex final: "do not count the primitive itself as a confirmed bug without a bad caller."
**Tracked as:** `try_ref` hardening + per-call-site review.

### `FetchTasklet::abort_task` Relaxed flag

**Pre-Codex score:** BLAST 4 × LIKE 3 × DISC 3 = 36.
**Post-Codex demotion:** T2/T3 ordering hardening.
**Source evidence:** Relaxed is sufficient for a standalone cancellation flag if no non-atomic payload is published through it. The audit's claim was that `abort_reason` publication rides on this flag, but the artifact did not show the cross-thread reader that observes the flag and then reads the payload. Codex final: "Otherwise demote to T2/T3 ordering-hardening."
**Tracked as:** Ordering documentation + payload-publication review.

### `pending_tasks` ordering

**Pre-Codex score:** BLAST 4 × LIKE 3 × DISC 3 = 36.
**Post-Codex demotion:** T2/T3 ordering policy cleanup.
**Source evidence:** The source mirrors Zig's monotonic increment, release decrement, acquire load pattern. The queue state is mutex-protected and the counter is a completion metric, not a synchronization payload publisher. Codex final: "Treat as ordering-policy cleanup unless a missing synchronization payload is identified."
**Tracked as:** Atomic-ordering policy review.

### `bun_libarchive_sys` orphan (45 sites)

**Pre-Codex score:** N/A (the crate has no JS-reachable surface).
**Post-Codex demotion:** stale-crate hygiene, not a soundness bug.
**Source evidence:** The crate appears in the workspace `Cargo.toml` as a member crate but no other crate names it as a dependency in its `[dependencies]`. The 45 unsafe bindings are dead from `bun_bin`'s reachable closure. Codex final: "stale-crate hygiene until confirmed by `cargo metadata` and build/link checks. Do not count it as a safety bug."
**Tracked as:** Repo-hygiene cleanup item (delete the crate or wire it in).

### Cross-T1-1: ThreadSafeRefCount and Cross-T1-3: install-pipeline atomics (5 sites)

**Pre-Codex score range:** BLAST 4 × LIKE 3 × DISC 3 = 36-48 (each).
**Post-Codex demotion:** T2/T3 cleanup; do not count without published-payload proof.
**Source evidence:** As above for Cross-T1-1. For Cross-T1-3, the pattern mirrors Zig's queue-state-protected monotonic counter.
**Tracked as:** Atomic-ordering hygiene; per-site review.

The mechanical effect of demoting these 11+ entries (plus the additional Codex pass-3 final demotions of `WeakPtrData`, `JsCell<T>`, and `RacyCell<T>` to T2 contract-defect status) is a reduction of approximately 600-700 risk-points from the pre-Codex T1 sum. Pass 4 then adds 280 points of newly verified semver/threading risk, leaving the corrected dashboard at 2,507 points.

---

## Methodology notes

**Why LIKELIHOOD is mostly 4 or 5 in this audit.** RISK-SCORING.md's LIKELIHOOD axis is calibrated for projects with 5-10 year old unsafe sites. Bun is post-port-commit `23427db` (~30 hours before the Pass-1 audit ran), so every site is brand new from the Zig translation. The "SAFETY comment >1yr old" anchor at LIKE=2 does not apply. Instead, this audit uses:

- LIKE=5 for sites that Codex's adversarial review confirmed as live UB (PUB-INSTALL-*, H9, B1-B5, FFI close UAF).
- LIKE=4 for sites with no/missing SAFETY comment where the translation gap is a known canonical Zig-to-Rust mistake (transmute<u8,Enum>, from_ref().cast_mut() patterns, debug_assert!-only bounds, Vec<u8>->Vec<u16> raw-parts).
- LIKE=3 for sites where the SAFETY comment exists but is fragile or stale (rare in this audit because the port is fresh).
- LIKE=2 for sites where Codex's review demoted the original Pass-3 confidence (these are mostly T2/T3 now, not T1).
- LIKE=1 is reserved for sites with explicitly proven SAFETY + recent review; we found very few of these.

**Why BLAST is mostly 4 or 5.** Bun's reachability surface is unusual: per the Pass-3 reachability synthesis, 99.48% of unsafe is JS-reachable through `bun_runtime`'s dep closure. The "system-level / 1000+ downstream" anchor of BLAST=5 maps directly to "every Bun user." BLAST=4 is reserved for sites reachable via specific subsystems (the FFI capability surface; the bundler in build-tool mode but not runtime mode; the cron subsystem; the SQL driver subsystems).

**Why DISC has the most spread.** DISC is where attacker-input-reachability really matters. The PUB-INSTALL-* and H9 sites are DISC=5 because they take untrusted bytes directly. The string-builder sites are DISC=3 because callers have to form a specific pattern. The cfg-gated sys sites are DISC=2 because they require platform-specific triggers. The DISC axis is the one a reviewer should most aggressively dispute per-finding; we have erred on the side of higher DISC where the trigger surface is plausible-but-uncommon.

---

## What is intentionally **not** in this risk table

- **Tier 2 architecture defects.** They have their own risk scoring but are not memory-safety bugs in the strict sense. See `audit/plans/CODEX-P3-cross-thread-task-send-boundaries.md` for the cross-thread-task contract defects, `CODEX-P3-static-mut-lifetime-and-writer-aliasing.md` for the writer aliasing, and the Tier 2 rows in `PASS3_FINDINGS_INDEX.md` for the rest.
- **Tier 3 watchlist.** Latent / threat-model-dependent items that need a future call-graph change to become active.
- **`bun:ffi` raw-pointer capability contracts** (FFI-CONTRACT-ADDR-LEN, FFI-CONTRACT-FINALIZER). These are out-of-contract by design; user supplies addresses; Bun does not promise validity. Counted separately to avoid inflating T1.
- **Pre-existing P3 leaks and availability bugs.** `leak-1`, `leak-2`, `drop-fchdir`, `drop-mysql` are real but are availability/memory-pressure issues, not soundness.
- **Perf-only B-candidates.** 17 `unreachable_unchecked` + 13 `get_unchecked` sites. Until benchmark logs are attached, these are not in the risk table per RISK-SCORING.md's "B-CANDIDATE-HOT" rule.

---

## Update cadence

This document is the post-Codex Pass-4 baseline. It should be regenerated:

1. After every wave of T1 fixes lands in the public Bun tree (re-score the remaining set; the total risk-points should drop monotonically).
2. After every drift-mode pass that discovers a new T1 entry (add a new row).
3. After every reviewer dispute that re-tiers a finding (move row between tables).

The `audit/synthesis/PASS3-reachability-and-test-coverage.md` heat-map is the foundation for any future re-scoring of BLAST radius. The `audit/synthesis/codex-pass2-safety-comment-gap.md` is the foundation for LIKELIHOOD re-scoring. DISC re-scoring should consult fuzz-target presence (none added yet at audit-time).

---

## Per-cluster risk projection (post-PR-set delta)

Once PR set 1 lands (PUB-INSTALL-1..4 + F-NEW-1/2 + H9), the risk-points cleared:

| Site | Risk before | Risk after fix | Delta |
|------|------------:|---------------:|------:|
| PUB-INSTALL-1 | 125 | 0 (closed) | -125 |
| PUB-INSTALL-2 | 125 | 0 | -125 |
| PUB-INSTALL-3 | 125 | 0 | -125 |
| PUB-INSTALL-4 | 125 | 0 | -125 |
| F-NEW-1 | 125 | 0 | -125 |
| F-NEW-2 | 125 | 0 | -125 |
| H9 | 125 | 0 | -125 |
| **PR set 1 total** | 875 | 0 | **-875** |

T1/T1-equivalent risk-points after PR set 1: `2,507 - 875 = 1,632`.

PR set 2 (StoreSlice, PUB-INSTALL-5/6, H5, FFI closeCallback, P3-BC-001, Unaligned::slice_align_cast, TH-1):

| Site | Risk before | Risk after fix | Delta |
|------|------------:|---------------:|------:|
| StoreSlice<T> Send/Sync | 80 | 0 | -80 |
| PUB-INSTALL-5 | 80 | 0 | -80 |
| PUB-INSTALL-6 | 80 | 0 | -80 |
| H5 | 80 | 0 | -80 |
| pre-existing-ub-10 (closeCallback) | 80 | 0 | -80 |
| P3-BC-001 (fmt::Raw UTF-8) | 80 | 0 | -80 |
| pre-existing-ub-ptr-2 (Unaligned cast) | 64 | 0 | -64 |
| TH-1 (GuardedLock !Send marker) | 30 | 0 | -30 |
| **PR set 2 total** | 574 | 0 | **-574** |

T1/T1-equivalent risk-points after PR set 2: `1,632 - 574 = 1,058`. Fifty-eight percent of the audit's debt is cleared if the first two batches land today.

PR set 3 (bundler B-1..B-4 uniform fix + P3-BC-002..005 string-builder + FFI close UAF + B-5 + PUB-INSTALL-7):

| Site | Risk before | Risk after fix | Delta |
|------|------------:|---------------:|------:|
| B-1 Renamer cascade | 60 | 0 | -60 |
| B-2 LinkerContext alias | 60 | 0 | -60 |
| B-3 LinkerContext+Chunk alias | 60 | 0 | -60 |
| B-4 Chunk alias CSS | 60 | 0 | -60 |
| B-5 CSS-AST prep alias | 45 | 0 | -45 |
| PUB-INSTALL-7 set_len | 60 | 0 | -60 |
| pre-existing-ub-9 FFI UAF | 60 | 0 | -60 |
| P3-BC-002 move_to_slice | 60 | 0 | -60 |
| P3-BC-003 BoundedArray resize | 60 | 0 | -60 |
| P3-BC-004 to_owned_slice_length | 60 | 0 | -60 |
| P3-BC-005 inflate | 60 | 0 | -60 |
| **PR set 3 total** | 645 | 0 | **-645** |

T1/T1-equivalent risk-points after PR set 3: `1,058 - 645 = 413`. **All P0 cleared.** The remaining 413 risk-points are spread across P1/P2 items.

PR set 4 cleans up the residual ~413 risk-points across U2.×8, UB-RT-001 encoding Vec roundtrip, F-1 linear_fifo, SysQuietWriterAdapter overflow, sourcemap header, U1 pack_command, and the cfg-gated sys/errno/windows items. The Codex-demoted contract defects (JsCell<T>, RacyCell<T>, WeakPtrData) are addressed separately in the T2 tranche.

---

## Cluster-level risk decomposition

The 40 T1/T1-equivalent entries decompose into 32 fine-grained remediation groups. Adjacent groups with the same owner or invariant can be batched into the PR sets above.

| Cluster | Entry count | Risk-pts | Cluster lead PR |
|---------|------------:|---------:|-----------------|
| install-niche-enum (PUB-INSTALL-1, -2) | 2 | 250 | `transmute<u8, Enum>` → `match`/`TryFrom`; uniform across Meta::has_install_script and Meta::origin |
| install-uninit-slice (PUB-INSTALL-3) | 1 | 125 | yarn.rs Dependency uninit; replace with push loop |
| install-bounds (PUB-INSTALL-4) | 1 | 125 | Tree.rs `get_unchecked` → checked indexing |
| install-semver-packed-string (F-NEW-1, F-NEW-2) | 2 | 250 | checked packed-string offset/length validation before `slice()` / `eql()` reads |
| install-alignment (PUB-INSTALL-5, -6) | 2 | 160 | `read_array<T>` alignment; switch to typed Vec or read_unaligned |
| install-uninit-row (PUB-INSTALL-7) | 1 | 60 | `set_len` before per-column load; defer set_len to after init |
| http-shared-mut (H9) | 1 | 125 | picohttp NUL-write; require `&mut [u8]` |
| http-content-length (H5) | 1 | 80 | buffer sizing + checked write |
| bundler-renamer-shared (B-1) | 1 | 60 | `Renamer<'r>` becomes shared borrow `&'r Renamer` |
| bundler-linker-aliased (B-2, B-3, B-5) | 3 | 165 | `*mut LinkerContext` worker discipline + `follow_all()` proof |
| bundler-chunk-aliased (B-4) | 1 | 60 | `*mut Chunk` for read-only printer access |
| bun_core-utf8 (P3-BC-001) | 1 | 80 | `from_utf8_lossy` |
| bun_core-uninit-tail (P3-BC-002, -004, -005) | 3 | 180 | StringBuilder / MutableString set_len discipline; truncate Box length to initialized len |
| bun_core-niche-T (P3-BC-003) | 1 | 60 | BoundedArray bound to `T: NoUninit` or migrate to `Vec<T>` |
| bun_core-unaligned (pre-existing-ub-ptr-2) | 1 | 64 | runtime alignment check |
| ffi-close-uaf (pre-existing-ub-9, pre-existing-ub-10) | 2 | 140 | invalidate JSFFIFunction wrappers; validate closeCallback address |
| ast-laundering (StoreSlice<T>) | 1 | 80 | bound Send/Sync |
| threading-guardedlock (TH-1) | 1 | 30 | add non-Send marker matching `MutexGuard` |
| ptr-cast-dealloc (U2.×8) | 8 | 48 | retain original owner across the 8 sites |
| ptr-mut-from-shared (U1) | 1 | 36 | thread mut owner through pack_command |
| webcore-encoding-roundtrip (UB-RT-001) | 1 | 48 | eliminate Vec raw-parts reinterpret |
| collections-niche (F-1 linear_fifo) | 1 | 45 | bound assume_init_slice<T: AnyBitPattern> or return initialized range only |
| writer-overflow (pre-existing-ub-ptr-4) | 1 | 48 | checked add before copy_nonoverlapping |
| sourcemap-bound (pre-existing-ub-ptr-6) | 1 | 36 | length guard before read_unaligned |
| standalone-graph-bound (pre-existing-ub-ptr-1) | 1 | 24 | release bounds check |
| io-publish-volatile (pre-existing-ub-ptr-3) | 1 | 24 | replace volatile+fence with AtomicPtr |
| windows-shim-bound (pre-existing-ub-ptr-5) | 1 | 24 | release bound check |
| sys-linux-getdents (sys-T1-3) | 1 | 16 | reclen >= 19 defensive guard |
| sys-macos-namlen (sys-T1-2) | 1 | 16 | zero-namlen bounds |
| sys-windows-unicode-string (sys-T1-4) | 1 | 16 | provenance fix on UNICODE_STRING::Buffer |
| errno-enum-checked (pre-existing-ub-001) | 1 | 16 | strum::FromRepr |
| libuv-shutdown-release-assert (uws-libuv-F2) | 1 | 16 | release-assert second-close check |

Per-cluster risk-points sum: `250 + 125 + 125 + 250 + 160 + 60 + 125 + 80 + 60 + 165 + 60 + 80 + 180 + 60 + 64 + 140 + 80 + 30 + 48 + 36 + 48 + 45 + 48 + 36 + 24 + 24 + 24 + 16 + 16 + 16 + 16 + 16 = 2,507` ✓ (matches per-finding total).

---

## Same-Day Execution Grouping

Per RISK-SCORING.md § "Risk-Score-Aware orchestration":

- **Top 24 entries** (~81% of risk-points) get ~60% of the audit's refactor budget.
- **Top 32 entries** (94% of risk-points) get ~85% of the budget.
- **Top 40 entries** (100% of risk-points) get the remaining budget but are not a release gate.

**Same-day execution groups:**

| Group | Risk-pts | Scope | Notes |
|-------|---------:|-------|-------|
| Batch 1 | 875 | PUB-INSTALL-1..4, F-NEW-1/2, H9 | Highest-risk attacker-input UB paths. |
| Batch 2 | 574 | StoreSlice, PUB-INSTALL-5/6, H5, FFI closeCallback, fmt::Raw, Unaligned cast, TH-1 | Mix of tiny fixes and public API hardening. |
| Batch 3 | 645 | Bundler B-1..B-5, PUB-INSTALL-7, pre-existing-ub-9, P3-BC-002..005 | Larger but still today's target; bundler requires the `follow_all()` / read-only-follow proof. |
| Batch 4 | 413 | U2.×8, UB-RT-001, F-1, writer overflow, sourcemap, U1, cfg-gated sys/errno/windows tail | Residual P1/P2 tail. |
| **Total** | **2,507** | All T1/T1-equivalent entries | Fix or explicitly justify any remainder today. |

This is now an execution queue, not a calendar projection.

---

## Per-axis sensitivity analysis

For the top-10 findings, here is the sensitivity of the risk score to each axis. This is how a reviewer can dispute a specific score: by arguing one axis is off by one and computing the new score.

### Top-1: PUB-INSTALL-1 at 125

Default: BLAST 5 × LIKE 5 × DISC 5 = 125.

| Axis | Current | If -1 | If +1 |
|------|--------:|------:|------:|
| BLAST | 5 | 100 | n/a (capped) |
| LIKELIHOOD | 5 | 100 | n/a |
| DISCOVERABILITY | 5 | 100 | n/a |

To drop PUB-INSTALL-1 below the P0 threshold (60), a reviewer would need to argue *two* axes are wrong by one step each (4 × 5 × 4 = 80, still P0; 4 × 4 × 4 = 64, still P0; 3 × 5 × 4 = 60, still P0). The finding is at the ceiling of the rubric; no single-axis dispute can demote it. This matches our intuition: a malicious lockfile in a public package triggering UB at install is the worst-quadrant primitive.

### Top-6 (tie): pre-existing-ub-002 StoreSlice<T> at 80

Default: BLAST 4 × LIKE 5 × DISC 4 = 80.

| Axis | Current | If -1 | If +1 |
|------|--------:|------:|------:|
| BLAST | 4 | 60 | 100 |
| LIKELIHOOD | 5 | 64 | n/a |
| DISCOVERABILITY | 4 | 60 | 100 |

A reviewer arguing BLAST should be 3 (because StoreSlice<T> is only used in the AST and AST is not on the JS-callable surface in the typical "user supplies bytes" sense) would drop the score to 60 (still P0). A reviewer arguing DISC should be 3 (because StoreSlice<Cell<u32>> is a compile-time witness rather than a runtime trigger) would also drop to 60. We have not gone lower because the type is foundational and any Send/Sync laundering reaches the worker pool.

### Top-6 (tie): pre-existing-ub-10 (FFI closeCallback) at 80

Default: BLAST 4 × LIKE 5 × DISC 4 = 80.

| Axis | Current | If -1 | If +1 |
|------|--------:|------:|------:|
| BLAST | 4 | 60 | 100 |
| LIKELIHOOD | 5 | 64 | n/a |
| DISCOVERABILITY | 4 | 60 | 100 |

A reviewer might argue this is "intentional bun:ffi capability" and pull it out of the T1 list entirely. The audit team rejected that framing because the membership-check obligation is on Bun's side: Bun's API exports a function that takes a JS-supplied address and runs `heap::take` on it. That is not a user-supplied raw pointer at the function-call boundary; that is Bun accepting a number and calling a primitive on it. Different category from `toArrayBuffer(addr, len)`.

### Bundler B-1..B-4 cluster at 60

Default: BLAST 3 × LIKE 5 × DISC 4 = 60.

| Axis | Current | If -1 | If +1 |
|------|--------:|------:|------:|
| BLAST | 3 | 40 (P1) | 80 (P0) |
| LIKELIHOOD | 5 | 48 (P1) | n/a |
| DISCOVERABILITY | 4 | 45 (P1) | 75 (P0) |

A reviewer arguing BLAST should be 4 (build-time bugs in a runtime are still production bugs because every Bun user runs `bun build`) would push the cluster to P0. We held at BLAST 3 because the audit's BLAST rubric specifies "build-tool only" as 3 and we wanted consistency. A reviewer arguing DISC should be 5 (every parallel chunk fan-out exercises this) would also push to P0. The cluster is borderline between P0 and P1; we keep it at P0 (60) because Codex's pass-3 final review explicitly promoted it from watchlist to confirmed-high-confidence UB.

---

## Confidence interval

The risk-score per finding is **subjective** in the way RISK-SCORING.md anticipates: each axis is a 5-point scale calibrated against the audit team's intuition. To make the subjective elements visible:

- **A defensible score range** around each entry is ±25% on the axis (i.e., a finding at 80 could defensibly be argued to 60-100; a finding at 125 is at the rubric ceiling).
- **The ordering of the top-22** is more robust than the absolute scores. Even with aggressive demotions, PUB-INSTALL-1..4 + H9 are at the top, the bundler + bun_core string-builder cluster is in the middle, and the cfg-gated platform-specific items are at the bottom.
- **The top-22-dominates-risk metric** is robust to ±10% perturbations of any individual score: the top is well-separated from the long tail.

For decision-making purposes, **the ordering is the load-bearing output**, not the precise numbers. The precise numbers are useful for ranking close-call clusters (e.g., is B-5 above or below the U2.×8 group?), but should not be used as evidence in a "this finding is more/less important than that finding by exactly N points" argument.

---

## Optional multi-dimensional score (EXPLOITABILITY)

RISK-SCORING.md § "Multi-dimensional scoring (optional)" supports adding EXPLOITABILITY for security-sensitive projects:

```
RISK_SCORE_4 = BLAST × LIKELIHOOD × DISCOVERABILITY × EXPLOITABILITY
```

EXPLOITABILITY (1-5):
- 1: requires specific environment; not practically exploitable.
- 5: direct memory-corruption primitive with a plausible exploit path. This optional axis is triage-only; it does **not** claim exploit development has been demonstrated.

For Bun, the top T1 entries with EXPLOITABILITY scored:

| ID | Risk-3 | EXPL | Risk-4 | Notes |
|----|-------:|-----:|-------:|-------|
| PUB-INSTALL-1 | 125 | 3 | 375 | Niche-violating enum construction from attacker-controlled lockfile byte. This is direct language-level UB; downstream exploitability is plausible but not demonstrated. |
| PUB-INSTALL-2 | 125 | 3 | 375 | Same invalid-enum UB shape as -1. |
| PUB-INSTALL-3 | 125 | 3 | 375 | Uninit Vec slice over attacker-controlled lockfile structure; data exposure/corruption impact requires further analysis. |
| PUB-INSTALL-4 | 125 | 4 | 500 | OOB read with attacker-controlled dependency index; classic information-disclosure primitive, but exploit development is not claimed. |
| H9 | 125 | 2 | 250 | SB-UB on every HTTP request, but the practical-exploit path through the Stacked Borrows violation is not demonstrated. Likely a latent miscompile primitive if the optimiser ever changes assumption. |
| pre-existing-ub-10 (FFI closeCallback) | 80 | 5 | 400 | Arbitrary-free / double-free via JS-supplied address; severe heap-corruption primitive, exploitability unproven. |
| pre-existing-ub-002 (StoreSlice<T>) | 80 | 1 | 80 | Send/Sync laundering is a soundness defect but not directly exploitable. |
| pre-existing-ub-9 (FFI close UAF) | 60 | 5 | 300 | UAF on freed JIT'd code is a severe use-after-free primitive; code-execution risk is plausible but not demonstrated. |
| P3-BC-001 fmt::Raw UTF-8 | 80 | 1 | 80 | Library UB on `&str` validity; subsequent compiler optimisations might break, but no demonstrated exploit path. |

The 4-dimensional ranking separates **reach** from **primitive shape**. The install findings remain release-gate priorities because their reach is universal; the FFI findings have more direct heap-corruption shapes but narrower, explicitly dangerous `bun:ffi` reach. This optional axis is for security-team triage, not a public exploitability claim.

For Bun's release-gate prioritisation, we keep the 3-dimensional score as the canonical ordering — the install P0s are still highest because their reach is universal — but security-team review may want the 4-dimensional ordering for incident-response triage.

---

## Cross-reference

- Master findings index (post-Codex): [`PASS3_FINDINGS_INDEX.md`](../../PASS3_FINDINGS_INDEX.md).
- Codex final review (the demotion list): [`CODEX_PASS3_FINAL_REVIEW.md`](../../CODEX_PASS3_FINAL_REVIEW.md).
- Codex pass 2 adversarial reclassification: [`codex-pass2-adversarial-reclassification.md`](codex-pass2-adversarial-reclassification.md).
- Invariants index: [`invariants.md`](invariants.md).
- Soundness debt dashboard (companion artifact): [`../../soundness-debt-dashboard.md`](../../soundness-debt-dashboard.md).
- Draft SECURITY.md proposal (companion artifact): [`../../SECURITY-public-ready.md`](../../SECURITY-public-ready.md).
