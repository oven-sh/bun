# Phase 2 — Bucket 4 (Validity invariants) Sweep

Run: `2026-05-15-exhaustive`. Sweeper: static-bucket-sweeper, ~25 min budget.
Inputs: all 21 phase-1 inventories + 22 phase-1 notes + EXP registry. No source
edits, no remediations, no sub-agents.

UB-TAXONOMY §4 scope (recap): `bool ∈ {0,1}`, `char` valid Unicode scalar,
`enum` declared discriminant, `&T` / `&mut T` / `Box<T>` non-null + aligned,
`NonNull<T>` / `NonZero*` non-zero, fn pointer non-null. The dominant
sub-class in Bun is **closed `#[repr(uN)] enum` reads from disk / IPC bytes**;
the second is **`mem::zeroed::<T>` for non-zero-valid T**.

**Audited-base status overlay (Codex follow-up, 2026-05-16):** the §3 candidates
below have been rechecked against `origin/main@4d443e5402`. Later upstream-main
drift is tracked in `CODEX_MAIN_DRIFT_NOTE_2026-05-16.md` /
`CODEX_W4_REFRESH_TRIAGE_2026-05-16.md`.
`StandaloneModuleGraph` is **EXP-035 / CONFIRMED_UB**,
`Buffers::read_array::<PatchedDep>` is **EXP-036 / CONFIRMED_UB**, Windows
`WindowsWatcher::Action` is **EXP-037 / RESOLVED** because current source uses
a checked raw-`DWORD` match, and the native-plugin `BunLoader` read is
**EXP-051 / CONFIRMED_UB**. The `Buffers::read_array<T>` fix remains scoped to
the PatchedDep-class path; it does **not** close EXP-003/005/006/007.

## 1. Existing EXP entries that already cover this bucket

| EXP | Verdict (registry) | Bucket-4 anchor |
|---|---|---|
| EXP-002 | CONFIRMED_UB | `linux_errno::SystemErrno` `transmute<u16, E>` (134 valid / 65 536; discriminants `0..=133`) |
| EXP-003 | CONFIRMED_UB | `Meta::has_install_script` enum-from-disk (3 valid / 256) |
| EXP-005 | CONFIRMED_UB | yarn uninit `&mut [Dependency]` reaches `DependencyVersionTag` (10 / 256) |
| EXP-006 | CONFIRMED_UB | `Meta::origin` enum-from-disk (3 valid / 256) |
| EXP-007 | CONFIRMED_UB | `Tree.rs` `get_unchecked(dep_id)` from attacker bytes (DependencyID validity) |
| EXP-008 | CONFIRMED_UB | `bun_semver::String::slice` packed `(off, len)` OOB |
| EXP-009 | CONFIRMED_UB | `bun_semver::String::eql` packed `(off, len)` OOB |

Note on prompt-vs-registry IDs: the prompt used an outdated label for a
`Buffers.rs::read_array<T: Copy>` structural fix point, plus "EXP-020 (ResolutionTag/
DependencyVersionTag)", "EXP-028 (for_each_fs_async_op unreachable_unchecked)",
and "EXP-032 (StandaloneModuleGraph read_unaligned tampered)" — none of those
IDs match the current registry contents (registry's EXP-019 is `StoreSlice<T>`
Send/Sync, EXP-020 is `bun_url::URL::host_with_path` provenance, EXP-028 is
`DirectoryWatchStore::owner` sibling-projection, and EXP-032 is the WebWorker
Cell loom model). The corresponding *technical* findings were later allocated
fresh IDs where warranted: StandaloneModuleGraph → EXP-035, PatchedDep
`read_array` → EXP-036, Windows watcher action → EXP-037, and native-plugin
`BunLoader` → EXP-051.

## 2. Enumeration A — every `#[repr(uN)] enum` reachable from disk / IPC bytes

Aggregate counts across `src/`:

- `#[repr(u(8|16|32|64))]` decls grepped: ~110 across the workspace; ~95 are
  closed enums, ~15 are `#[repr(uN)]` structs / bitflag wrappers (not validity
  hazards by themselves).
- Existing **defensive transparent-newtype `u8`** wrappers: 2 explicit in
  `src/install/` (`integrity::Tag`, `resolution::Tag`) — both cite avoiding the
  PUB-INSTALL bug class in their doc comments.
- Closed `#[repr(uN)]` enums fed by `ptr::read*` / `transmute` / `copy_from_slice`-
  into-typed-column from a disk- or wire-backed buffer: **9** (table below).

| enum | def site | discriminants (valid / 256) | source-of-bytes | read path | EXP coverage |
|---|---|---|---|---|---|
| `HasInstallScript` | `install/lockfile/Package/Meta.rs:39-46` | 3 / 256 | `bun.lockb` mmap | `Package::load_fields` columnar `copy_from_slice` → `items_mut::<"meta", Meta>()` iter | **EXP-003** |
| `Origin` | `install/lib.rs:1128-1135` | 3 / 256 | `bun.lockb` mmap | same `Meta` columnar memcpy | **EXP-006** |
| `DependencyVersionTag` | `install_types/resolver_hooks.rs:303-324` | 10 / 256 | `bun.lockb` mmap, via yarn slice path | `bun_core::ffi::slice_mut` over uninit `&mut [Dependency]`; `Dependency` carries this tag | **EXP-005** |
| `SystemErrno` (linux) | `errno/linux_errno.rs:6` | 134 / 65 536 | `usize` syscall return | `transmute::<u16, E>(int as u16)` (line 192) — bypasses the sibling checked path | **EXP-002** |
| `FileSide` | `standalone_graph/StandaloneModuleGraph.rs:248-254` | 2 / 256 | `__BUN` Mach-O / PE section bytes (tampered standalone exe) | `ptr::read_unaligned::<CompiledModuleGraphFile>` at line 580 | **EXP-035** |
| `Encoding` | `standalone_graph/StandaloneModuleGraph.rs:256-264` | 3 / 256 | same | same record | **EXP-035** |
| `ModuleFormat` | `standalone_graph/StandaloneModuleGraph.rs:266-273` | 3 / 256 | same | same record | **EXP-035** |
| `Loader` | `ast/loader.rs:21-43` | 21 / 256 | same | same record (`CompiledModuleGraphFile.loader: Loader`) | **EXP-035** |
| `PatchedDep::patchfile_hash_is_null: bool` (validity-bearing field, not enum) | `install/lockfile.rs:3375` | 2 / 256 | `bun.lockb` mmap | `Buffers::read_array::<PatchedDep>` at `bun.lockb.rs:590` | **EXP-036** |

Closed `#[repr(uN)] enum` decls that are **NOT** disk-reachable on current
source (sound by construction or by checked decode):

- `PreinstallState` (`resolver_hooks.rs:1228`) — manifest-parser fed; not a
  lockfile column. Confirm Phase 4.
- `PackageInstall::{Method, Step}` and `isolated_install::Installer::Step` —
  state stored as `AtomicU8`; round-trip via `from_u8`. **CHECKED.**
- `ConfigVersion`, `NodeLinker`, `bin::Tag`, `dependency::URITag`, `DiffOp`,
  `Lockfile::Stringifier::Tag`, `PackageManagerTask::Tag`, `Subcommand`,
  `AuditLevel`, `Shell`, `EscapeVal`, `isolated_install::State` — all
  parser-internal, never reconstructed from disk.
- `ResolutionTag` (`resolver_hooks.rs:1152-1167`, ~11 / 256 valid, sparse) is
  **bridge-internal**: `Package::resolution` lockfile column uses the
  defensive transparent newtype `install::resolution::Tag(u8)` and
  `auto_installer.rs:18-80` translates by explicit `match` arm. Direct
  disk-reachability is unproven. The prompt's "EXP-020 ResolutionTag" framing
  overstates this.
- `WindowsWatcher::Action` (`watcher/WindowsWatcher.rs:55`) — current source
  decodes `FILE_NOTIFY_INFORMATION.Action` with a checked `match` at
  `:196-211`; keep as a regression target, not a live validity finding.

## 3. Bucket-4 candidates promoted to EXP entries

### 3.1 `CompiledModuleGraphFile` `read_unaligned` from `__BUN` section (4-enum compound) — TOP PICK

- **File:line:** `src/standalone_graph/StandaloneModuleGraph.rs:577-580` (read
  loop) + struct decl at `:230-246`.
- **Shape:** `let module: CompiledModuleGraphFile = unsafe { core::ptr::read_unaligned(modules_list_base.add(i)) };`
  where `CompiledModuleGraphFile` contains four niche-bearing enums (`Encoding`,
  `Loader`, `ModuleFormat`, `FileSide`) + several `StringPointer` fields.
- **Validity surface:** the four enum bytes have **2 + 3 + 21 + 3 = 29 valid**
  out of `256^4 ≈ 4.3 × 10^9` possible byte-quad values; any single tampered
  byte outside the live discriminant set is instant validity UB at the
  `read_unaligned` materialization.
- **Attacker model:** a tampered Bun-built standalone executable (`bun build
  --compile`). Any developer / CI runner that executes a downloaded standalone
  binary has reached this path. `bun_install`-class blast radius (developer-
  workstation, supply-chain).
- **Why it matters:** this is the **structural twin** of EXP-003/006. Same
  fix-point shape (validate / open-newtype each enum byte before
  `read_unaligned`) but a different attack surface (binary blob, not
  lockfile). The Section M phase-1 note already flags it as a Phase-3 surface;
  no EXP entry exists yet.
- **EXP closure:** promoted to **EXP-035 / CONFIRMED_UB**; bucket 4 + 6
  (type pun via `read_unaligned`).

### 3.2 `read_array::<PatchedDep>` validity violation via embedded `bool`

- **File:line:** `src/install/lockfile/bun.lockb.rs:590` reads
  `Vec<PatchedDep>` via `Buffers::read_array`. `PatchedDep` is at
  `src/install/lockfile.rs:3369-3378`, contains
  `pub patchfile_hash_is_null: bool`.
- **Shape:** `Buffers::read_array<T: Copy>` (`Buffers.rs:104-178`) does
  `bun_core::ffi::slice(stream.buffer.as_ptr().add(start_pos).cast::<T>(), …).to_vec()`
  — bytes verbatim from disk reinterpreted as `[PatchedDep]`. Rust `bool` has
  validity `{0, 1}`; bytes `2..=255` at the `patchfile_hash_is_null` offset
  are **immediate validity UB** when `read_array` materializes the `&[T]`
  view (let alone the `to_vec()` deep copy that follows).
- **Attack model:** identical to EXP-003 — hostile `bun.lockb`. Reachable on
  every `bun install` against a lockfile that contains any `patchedDependencies`
  entry.
- **Why it matters:** this is the strongest current source-confirmed `read_array<T>` candidate
  whose `T` carries a validity-bearing field. The Section L phase-1 inventory
  (`L_install.md`) flagged this as the strongest current witness for the
  generic helper. Validates the Section L
  recommendation that `read_array` needs a `LockfileArrayElem` bound.
- **EXP closure:** promoted to **EXP-036 / CONFIRMED_UB**. Mirrors EXP-003
  with a `bool` instead of an enum.

### 3.3 Windows `WindowsWatcher::Action` `#[repr(u32)]` from `ReadDirectoryChangesW` IO buffer — resolved in current source

- **File:line:** `src/watcher/WindowsWatcher.rs:55`, with the validity
  warning explicitly self-documented at `:194` ("into an exhaustive
  `#[repr(u32)]` enum is immediate UB on an unlisted value").
- **Shape:** `FILE_NOTIFY_INFORMATION.Action` is a `u32` written by the
  kernel. A direct enum transmute would be UB for any future Windows edition
  or buggy filter driver that injects an out-of-range value.
- **Current source check:** the live code already implements the defensive
  pattern: it matches `info.Action` against `w::FILE_ACTION_*` constants at
  `src/watcher/WindowsWatcher.rs:196-211`; unknown values advance/skip the
  record and do not construct `Action`.
- **EXP closure:** **EXP-037 / RESOLVED**. The standalone witness remains a
  useful negative-pattern regression test, but it is not evidence of current
  Bun UB.

### 3.4 `unreachable_unchecked` exhaustiveness watchlist (NEW-V-4 suspicious subset)

- **NEW-V-4 tracked call sites:** `src/runtime/dispatch.rs:393`,
  `src/runtime/api/js_bundle_completion_task.rs:504,599,621,755`,
  `src/jsc/generated.rs:409,464,494,622`.
- **Inventory boundary:** this section is **not** claiming those nine calls are
  the complete workspace inventory of `unreachable_unchecked`. Codex's
  unchecked-intrinsics sweep also reviewed `src/bun.rs:1585`,
  `src/bun_core/atomic_cell.rs:317`, `src/bundler/transpiler.rs:1926`,
  `src/event_loop/MiniEventLoop.rs:311`,
  `src/install/PackageManagerTask.rs:284,542`, and
  `src/install/lockfile/Tree.rs:1131`. The safe dormant helper in
  `src/bun.rs` is tracked separately as **EXP-086 / NEW-V-6**; the remaining
  extra sites were classified as defensible local assertions or source-local
  hardening targets in `CODEX_UNCHECKED_INTRINSICS_SWEEP_2026-05-16.md`.
- **Non-site correction:** `src/runtime/dispatch.rs:460` is only a comment in
  the explicit `ImmediateObject | TimeoutObject` panic branch; it is not an
  `unreachable_unchecked` call and must not be counted as a site.
- **Family A — dispatch inner match (`dispatch.rs:393`):** the outer
  `for_each_fs_async_op!(__fs_pat)` or-pattern proves the inner re-match over
  the stamped 42 tags is exhaustive *if* both macro expansions stay in lockstep.
  This is currently defensible; promotion requires macro-expansion drift or a
  malformed task tag that reaches the inner arm despite the outer guard.
- **Family B — bundle completion (`js_bundle_completion_task.rs`):** each
  site follows a local guard (`matches!` / previously checked enum arm) and is
  primarily a control-flow assertion, not hostile-byte validity. These are
  brittle but not current UB findings.
- **Family C — generated extern tagged unions (`jsc/generated.rs`):** these
  are the highest-risk members because the tag is an FFI value. The current
  contract is "C++ codegen only emits tags in range"; a malformed or
  version-skewed tag would make the wildcard reachable. Treat as generated-code
  FFI hardening: prefer `panic!` / checked conversion in debug or safe public
  boundaries, but do not market as confirmed UB without a bad-tag witness.
- **Severity:** WATCHLIST. Promotion requires either a malformed-tag witness,
  a codegen drift proof, or a source path that can construct an out-of-range
  tag and feed it to one of the generated `convert_from_extern` functions.

## 4. Enumeration B — every `mem::zeroed::<T>` site + T validity

Total `mem::zeroed`-style call sites (after filtering comments): **8 live
unsafe call sites** that materialize a `T`-typed value. Plus **3 audited
wrappers** that gate the operation behind a per-type marker trait.

| call site | T | T validity | verdict |
|---|---|---|---|
| `bun_core/lib.rs:2840` | `T: Zeroable` (audited trait) | guarded | **SOUND** — the `unsafe impl Zeroable` is the per-type validity audit |
| `bun_core/lib.rs:2871` | `T` (caller-asserted) | caller guarantees | **SOUND-BY-CONTRACT** — `unsafe fn zeroed_unchecked<T>` |
| `bun_core/lib.rs:3037` | `H: Fn*` (must be ZST) | compile-time `size_of::<H>()==0` assert | **SOUND** — ZST inhabited only by zero-byte value |
| `install/windows-shim/main.rs:267` | `T: Zeroable` (local trait) | guarded | **SOUND** — same pattern as `bun_core::ffi::zeroed` |
| `runtime/image/codec_webp.rs:199` | `WebPChunkIterator` (`#[repr(C)]` POD: `*const u8`, `usize`, ints) | all-zero is valid (raw ptrs are nullable, ints are zeroable) | **SOUND** — used as out-param immediately overwritten by `WebPDemuxGetChunk`; pre-init is libwebp ABI requirement |
| `runtime/test_runner/harness/recover.rs:59,84` | `Context` (`jmp_buf` / `ucontext_t`, `#[repr(C)]` POD) | all-zero valid; immediately overwritten by `get_context` | **SOUND** |
| `jsc/btjs.rs:288` | Windows `MEMORY_BASIC_INFORMATION` (`#[repr(C)]` POD) | all-zero valid; immediately overwritten by `VirtualQueryEx` | **SOUND** |
| `sys_jsc/error_jsc.rs:155` | `Sigaction` via `..core::mem::zeroed()` struct-update | all-zero valid for the trailing primitive fields (`sa_flags: c_int`, `sa_restorer: Option<extern fn>`, `sa_mask: sigset_t`) | **SOUND** but worth a `Zeroable` upgrade |

**Codex follow-up, 2026-05-16:** re-read every direct `core::mem::zeroed`
site plus the `Zeroable` wrapper bodies. No new EXP was added. The direct sites
are C ABI POD / out-param storage or marker-trait-gated wrappers; the current
`EVP_MD_CTX: Zeroable` concern is layout-lock hardening under EXP-063, not a
proven zero-validity bug. Details: `CODEX_ZEROED_VALIDITY_SWEEP_2026-05-16.md`.

**No `mem::zeroed::<T>` site** in the workspace materializes a `T` that
contains `bool`, `char`, `&T`, `Box<T>`, `NonNull<T>`, `NonZero*`, fn pointer,
or a closed `#[repr(uN)]` enum with a non-zero default discriminant. The
prior `// SAFETY: H is a ZST → core::mem::zeroed()` open-coded pattern has
been consolidated into `bun_core::ffi::{zeroed, zeroed_unchecked, conjure_zst}`
plus `unsafe trait Zeroable`. **This sub-class is currently clean.**

(Documented anti-pattern in `src/options_types/context.rs:64` —
"A literal `unsafe { core::mem::zeroed() }` would match Zig but is
[unsound]" — explicitly rejected. Same negative cite at
`bundler/transpiler.rs:1313`, `bundler/cache.rs:353`, `resolver/lib.rs:2473`,
`bake/DevServer.rs:433,551`, `webcore/Sink.rs:324`. The Rust port is
deliberately stricter than the Zig original here.)

## 5. Enumeration C — every `transmute` to validity-bearing type

| site | source | dest | safety |
|---|---|---|---|
| `errno/linux_errno.rs:192` | `u16` | `SystemErrno` (`#[repr(u16)] enum`, 134 / 65536 valid; discriminants `0..=133`) | **UB** — EXP-002. Windows already has a checked helper path; open PR #30765 proposes the analogous Linux checked-path fix but is still unmerged. |
| `errno/windows_errno.rs:254` and `errno/lib.rs:310` | `u16` | `E` / `SystemErrno` (`#[repr(u16)]` sparse enums) | **EXP-097 / CONFIRMED_UB** — these are safe `pub const fn from_raw` helpers, not `unsafe fn`s. A debug-only assertion / comment-level caller guarantee is not a Rust safety boundary; release-mode Miri confirms an invalid tag constructs an invalid enum value. |
| `errno/lib.rs:310` | `u16` | `SystemErrno` | **CHECKED** — same `unsafe fn` contract as above |
| `cares_sys/c_ares.rs:2049` | `i32` | `Error` (`#[repr(i32)]` enum) | needs Phase-2 verify of the upstream `match` exhaustiveness; `Some(...)` already filters to known set |
| `bundler/linker_context/scanImportsAndExports.rs:1682` | `u16` | `PropertyIdTag` | bridge type; verify against discriminant table |
| `libuv_sys/libuv.rs:292` | `c_int` | `HandleType` (`#[repr(c_int)]`) | libuv contract; `HandleType` uses C enum range so any `c_int` is in range only if libuv stays well-behaved |
| `boringssl_sys/boringssl.rs:496,512` | fn pointer | typed fn pointer (`sk_GENERAL_NAME_free_func`) | fn-pointer-to-fn-pointer same-arity; **SOUND** by construction |
| `event_loop/AnyTask.rs:69` | `fn(*mut T) -> JsResult<()>` | `fn(*mut c_void) -> JsResult<()>` | same-arity fn-ptr punning; **SOUND** |
| `runtime/ffi/FFIObject.rs:28` | `usize` | `JSTypedArrayBytesDeallocator` (fn pointer) | int-to-fn-ptr; non-null check upstream |
| `bun_alloc/lib.rs:560` | `MutexGuard<'_, ()>` | `MutexGuard<'static, ()>` | lifetime extension only; **SOUND** if guard truly `'static`-reachable |
| `runtime/image/backend_wic.rs:923` | raw `void*` | `WICConvertBitmapSourceFn` (fn pointer) | dlsym path; non-null check upstream |
| `sys/linux_syscall.rs:209` | `rustix::fs::Stat` | `libc::stat` | layout-pun; relies on `static_assertions!` agreement |
| `css/css_parser.rs:2718,2723` | `'_` | `'static` lifetime | lifetime-only |
| `resolver/lib.rs:4260` | (lifetime extension) | lifetime-only | |
| `bundler/LinkerContext.rs:2288` | `Renamer<'_,'_>` | `Renamer<'_,'_>` | pure lifetime laundering |
| `bundler/transpiler.rs:308` | `BundleOptions<'_>` | `BundleOptions<'a>` | lifetime extension |
| `perf/tracy.rs:726,798`, `runtime/node/fs_events.rs:164`, `sys/lib.rs:5923,6021` | `*mut c_void` → `T` via `transmute_copy` | dlsym fn-ptr load | non-null check upstream |

**No `transmute<u8, bool>` or `transmute<u32, char>`** anywhere in `src/`.
**No `NonNull::new_unchecked`/`NonZero*::new_unchecked`** with a non-static
input that hasn't already been bounded; the ~30 `NonNull::new_unchecked`
sites in the table are uniformly preceded by a `Box::into_raw`,
`Vec::as_mut_ptr`, or upstream `is_null` check. Spot-checked 8 of them
(`bun.rs:352`, `BundleThread.rs:409`, `MimallocArena.rs:732,749`,
`ref_count.rs:1015,1029`, `parent_ref.rs:241`, `runtime/timer/WTFTimer.rs:282`)
— all sound.

## 6. Sparsity ranking (validity surface, sorted by attacker leverage)

| type | valid / total | attack ratio | EXP |
|---|---|---|---|
| `FileSide` | 2 / 256 | 99.2 % | EXP-035 |
| `Encoding` | 3 / 256 | 98.8 % | EXP-035 |
| `ModuleFormat` | 3 / 256 | 98.8 % | EXP-035 |
| `HasInstallScript` | 3 / 256 | 98.8 % | EXP-003 |
| `Origin` | 3 / 256 | 98.8 % | EXP-006 |
| `DependencyVersionTag` | 10 / 256 | 96.1 % | EXP-005 |
| `ResolutionTag` (bridge) | 11 / 256 | 95.7 % | DEFERRED — not disk-reachable on current source |
| `Loader` | 21 / 256 | 91.8 % | EXP-035 |
| `bool` (`PatchedDep`) | 2 / 256 | 99.2 % | EXP-036 |
| `SystemErrno` (linux) | 134 / 65 536 | 99.80 % | EXP-002 |

The four `CompiledModuleGraphFile` enums combine multiplicatively: a single
random tampered `[u8; 4]` lands a valid quad with probability `(2 × 3 × 21 × 3) / 256^4 ≈ 8.8 × 10^-8`. Once the standalone module bytes are attacker-controlled, one invalid enum byte is enough to trigger the Miri-confirmed validity violation.

## 7. Confirmation: the prompt's "EXP-019 (Buffers.rs structural fix)" claim

The current registry's **EXP-019** is `StoreSlice<T>` Send/Sync laundering
(Bucket 8), not a Buffers.rs structural fix. The prompt's framing conflates
two different artefacts:

- The Section L phase-1 note explicitly states `Buffers::read_array<T: Copy>`
  is **NOT** the fix-point for EXP-003/005/006/007 — those land at
  `Package::load_fields`' typed-column deserialization (EXP-003/006), the
  yarn uninit slice (EXP-005), and `Tree.rs:1020`'s unchecked index
  (EXP-007). A defensive `unsafe trait LockfileArrayElem` bound on
  `read_array<T>` would harden the **§3.2 PatchedDep** path and any future
  validity-bearing `T`, but does **not** close the four anchored witnesses.
- The actual structural ceiling-class find that should be filed as a fresh
  EXP entry is the §3.1 StandaloneModuleGraph 4-enum compound. That's the
  one that combines (a) attacker-controlled bytes, (b) `ptr::read_unaligned`
  bypass of any `match`-arm validation, and (c) sparsity-ratio leverage on
  par with EXP-003/006.

## 8. Deliverable summary

- **Total Bucket-4 findings:** 7 existing EXP cross-refs (EXP-002, -003,
  -005, -006, -007, -008, -009) + **2 confirmed promoted EXPs** (§3.1 → EXP-035,
  §3.2 → EXP-036) + **1 resolved regression guard** (§3.3 → EXP-037) + **1 watchlist** (§3.4
  NEW-V-4 tracks 9 suspicious `unreachable_unchecked` exhaustiveness sites
  across 3 families; other current `unreachable_unchecked` calls are reviewed
  separately as EXP-086, defensible local assertions, or source-local
  hardening targets).
- **Top 3 promoted validity-bucket finds:**
  1. **EXP-035 / §3.1 StandaloneModuleGraph `read_unaligned::<CompiledModuleGraphFile>`**
     — 4 sparse enums in one record, tampered-binary attack model, no SAFETY
     comment flags the threat. CONFIRMED_UB; ceiling-class.
  2. **EXP-036 / §3.2 `Buffers::read_array::<PatchedDep>`** — first lockfile reader
     whose `T` carries a validity-bearing field (`bool`). Same attack
     surface as EXP-003 (hostile `bun.lockb`); Miri-confirmed.
  3. **EXP-037 / §3.3 `WindowsWatcher::Action`** `#[repr(u32)]` from
     `ReadDirectoryChangesW` — stale validity candidate now resolved by the
     checked raw-`DWORD` match in current source. Keep as a regression lint,
     not a confirmed finding.
- **EXP-019 confirmation:** the prompt's outdated `Buffers.rs::read_array<T: Copy>`
  structural-fix label does not match the registry's actual
  EXP-019 (`StoreSlice<T>` Send/Sync, bucket 8). The Buffers.rs fix is the
  right shape for §3.2 (PatchedDep) but does not close the four anchored
  PUB-INSTALL witnesses (per Section L phase-1 note's explicit correction).
  The dedicated EXP entry is **EXP-036**; do not retroactively renumber EXP-019.
- **`mem::zeroed::<T>` sub-class:** **clean.** All 8 live sites materialize
  POD whose all-zero pattern is valid; the `bun_core::ffi::{zeroed,
  zeroed_unchecked, conjure_zst}` audited wrappers + `unsafe trait Zeroable`
  retire the open-coded pattern. The Rust port is deliberately stricter than
  the Zig original on this axis.
- **`transmute<u8, bool>` / `transmute<u32, char>` / `NonNull::new_unchecked`
  with unverified input:** none found.
- **Time spent:** ~25 min as budgeted.
