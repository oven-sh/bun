# Section L: install-and-pkg-manager

## Purpose

`bun install` is Bun's npm-compatible package manager (rooted at the
`bun_install` Cargo crate at `src/install/`, with `bun_install_jsc` providing
the JSC-visible bindings and `bun_install_types` the resolver-side
projections).  It resolves the dependency graph of a `package.json`, downloads
and extracts tarballs, hardlinks/copies files into `node_modules`, runs
lifecycle scripts, and persists the result as a binary `bun.lockb` (with a
companion textual `bun.lock`).  It also reads competitor lockfiles
(`yarn.lock` via `yarn.rs`, `pnpm-lock.yaml` via `pnpm.rs`, npm
`package-lock.json` via `migration.rs`) for compatibility.  The disk lockfile
is the **primary attack surface in this section** — a clone of a malicious
git repo can ship an arbitrary `bun.lockb`.

## Unsafe-surface tally

| | sites |
|---|---|
| Total unsafe sites (grep) | **583** (576 + 2 + 5) |
| Files with unsafe code | 49 |
| `#[repr(u8)]` enums (closed, validity-bearing) | 12 |
| `#[repr(transparent)]` u8 newtypes (defensive — open) | 2 (`integrity::Tag`, `resolution::Tag`) |
| `extern "C"` decls / `unsafe extern` blocks | 7 |
| `unsafe impl Send`/`Sync` / `Linked` | ~7 (excluding the 11 `padding_checker::AssertNoUninitializedPadding` trait impls) |
| `mem::forget` | 2 (NetworkTask) |
| `core::hint::unreachable_unchecked` | 3 (PackageManagerTask × 2 + Tree.rs × 1) |
| `MaybeUninit::assume_init` family | ~30 (path-buffer pools + HARDLINK_QUEUE + ARENA + DepthBuf + Tree.rs:91) |
| `set_len` raw calls | 7 (yarn.rs 1401-1402, migration.rs 1492-1493, Package.rs 3370/3432, lockfile.rs 2898) |
| `from_raw` / `from_raw_mut` (ZStr, ParentRef, BackRef, Box) | ~50 |
| `get_unchecked` (attacker-derived index) | **1** (Tree.rs:1020 — EXP-007 anchor) |
| `transmute` (true call) | **0** — the section explicitly rejects it (auto_installer.rs:18-80, resolution.rs:879-890, integrity.rs:252-260) |
| `bun_core::ffi::slice` / `slice_mut` (raw `*const T` → `&[T]`) | 4 (Buffers.rs:170, yarn.rs:918-925) |
| `static_assertions!` / `const _: () = assert!` | 26 |

The dominant pattern is the **ParentRef / BackRef / `borrow = ptr` discipline**
(see `CLAUDE.md` "Pointer provenance at FFI boundaries") for callback-may-free-
self contexts; comments are uniformly strong on those.  The **second-largest
cluster** is `MaybeUninit` + path-buffer save/restore (`set_length`) for the
Windows-friendly 64 KB path pool, also well-documented.

The class with the **weakest invariant story** is byte-copy-into-typed-column
(`copy_from_slice` into a `&mut [T]` cast view) where `T` carries a closed-enum
discriminant — this is exactly the PUB-INSTALL-1..4 class, and it remains
unfixed.

## Lockfile parser shape

**Binary lockfile parser** (the source-of-truth path for `bun.lockb`):

- `src/install/lockfile/bun.lockb.rs:340` — `Serializer::load`, the top-level entry
- `src/install/lockfile/Buffers.rs:457` — `Buffers::load`, calls `read_array` per buffer
- `src/install/lockfile/Buffers.rs:104` — **`pub fn read_array<T: Copy>(stream) -> Vec<T>`** — the generic on-disk-bytes → `Vec<T>` reader; alignment validated, **validity NOT validated**
- `src/install/lockfile/Package.rs:3311` — `Serializer::load`, packages columnar load
- `src/install/lockfile/Package.rs:3439` — `load_fields`, per-column `bytes.copy_from_slice(stream.buffer)` into `column_bytes_mut(field)` — the canonical PUB-INSTALL primitive

**Every `#[repr(u8)]` enum in the section** (with disk reachability flag):

| enum | file:line | declared discriminants | read path | reachable from `bun.lockb` |
|---|---|---|---|---|
| `HasInstallScript` | `lockfile/Package/Meta.rs:39-46` | 0,1,2 | UNCHECKED (Package.rs:3466 copy_from_slice → meta column iter at 3472) | **YES — EXP-003** |
| `Origin` | `install/lib.rs:1128-1135` | 0,1,2 | UNCHECKED (Meta.origin field, same memcpy as above) | **YES — EXP-006** |
| `DependencyVersionTag` | `install_types/resolver_hooks.rs:303-324` | 0..=9 | UNCHECKED through the `yarn.rs` uninitialized `&mut [Dependency]` path; `read_array::<dependency::External>` itself reads `[u8; N]` and decodes the tag byte by explicit match/panic | **YES — EXP-005** |
| `ResolutionTag` | `install_types/resolver_hooks.rs:1152-1167` | {0,1,2,4,8,16,32,64,72,80,100} (~11/256 valid) | bridge-internal closed enum; `Package::resolution` on disk uses `install::resolution::Tag` transparent `u8` newtype with `_` handling | no direct disk reachability proven |
| `PreinstallState` | `install_types/resolver_hooks.rs:1228-1235` | 0..=N (debug `enum(u4)` Zig) | manifest-parser fed; *probably* not disk | partial — confirm Phase 2 |
| `PackageInstall::Method` | `install/PackageInstall.rs:69-77` | enum_map-derived | CHECKED — round-trip via `from_u8` | no |
| `PackageInstall::Step` | `install/PackageInstall.rs:219-247` | atomic state machine | CHECKED — `Step::from_u8`/`from_u32` | no |
| `isolated_install::Installer::Step` | `install/isolated_install/Installer.rs:691-700` | mirror of above | CHECKED | no |
| `DiffOp` | `install/lockfile/Package.rs:978-985` | constructor-only | n/a | no |
| `Stringifier::Tag` | `install/lockfile.rs:2785-2790` | writer-only | n/a | no |
| `CommandLineArguments::*` | `install/PackageManager/CommandLineArguments.rs:533-` | CLI parser | argv-only | no |
| `PackageManagerTask::*` | `install/PackageManagerTask.rs:597-` | in-mem state | n/a | no |
| `ConfigVersion` | `install/ConfigVersion.rs:6-` | small bounded set | parsed via `match` | no (validated) |
| `NodeLinker` | `install_types/NodeLinker.rs:5-` | small bounded set | parsed via `match` | no (validated) |
| `bin::Tag` | `install/bin.rs:543-` | small bounded set | columnar bin field; **needs Phase-2 confirmation** | maybe |
| `PackageManager::*` | `install/PackageManager.rs:516-` | strum-derived | not disk | no |
| `patchPackage::EscapeVal` | `install/PackageManager/patchPackage.rs:700-` | parser-internal | n/a | no |
| `isolated_install::State` | `install/isolated_install.rs:91-` | in-mem state | n/a | no |

**Defensive transparent-newtype pattern (preferred for disk bytes):**

- `integrity::Tag(u8)` (`install/integrity.rs:252-260`) — **explicitly cites avoiding the PUB-INSTALL bug class** ("A Rust `#[repr(u8)] enum` would be UB for unknown discriminants, so we use a transparent newtype")
- `resolution::Tag(u8)` (`install/resolution.rs:879-890`) — same defensive comment

The pattern is *known* to the install-crate authors but applied inconsistently.
The most clearly disk-reachable closed enums are `HasInstallScript` and
`Origin` in `Meta`, plus `DependencyVersionTag` through the yarn uninitialized
slice path. Do not count `resolver_hooks::ResolutionTag` as a direct
lockfile-from-disk UB unless a later experiment finds a real `read_array` /
column-copy path into that exact type.

**Every `get_unchecked` with attacker-controlled index:**

- `src/install/lockfile/Tree.rs:1020` — `deps.get_unchecked(dep_id as usize)`, where `dep_id` came from `*this_deps_ptr.add(i)` (the parent tree's dependency-id slice, which is itself read from `bun.lockb`). **Not bounds-checked.** EXP-007 anchor still applies.

**Every `Vec::with_capacity(n)` → `set_len(n)` without explicit init between:**

- `src/install/lockfile/Package.rs:3370` (v2-migration arm) and `:3432` (the regular load arm). Both rely on the subsequent `load_fields` call to overwrite every column, but `load_fields` can `return Err(...)` partway through column 0..7 with the tail still uninit; if `Drop` later runs on `List<Package>`, it interprets those bytes as `Package`. Phase 2 should hand-verify whether `Drop` reads any of the per-column fields before they're written.
- `src/install/yarn.rs:1401-1402` — `set_len(final_deps_len)` for both `dependencies` and `resolutions` buffers; preceded by a fill loop that writes every slot up to `final_deps_len` IFF every entry was processed without `continue` shortcuts (the loop has several `continue` paths). Phase 2 needs to trace control flow.
- `src/install/migration.rs:1492-1493` — same shape as yarn.rs:1401-1402, applied during npm `package-lock.json` migration.
- `src/install/lockfile.rs:2898` — `set_len(l_len + r_len)` in `Lockfile::eql`; sound, the subsequent loop unconditionally writes every slot.

## Notable patterns

### Re-confirmation of the four PUB-INSTALL anchored witnesses

**EXP-003 — `Meta::has_install_script` enum-from-disk** — STILL APPLIES.

`src/install/lockfile/Package/Meta.rs:38-46` quote (still verbatim per the
prior pass-4 trace):

```rust
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum HasInstallScript {
    Old = 0,
    #[default]
    False,
    True,
}
```

Reachability: `Package::load_fields` at `lockfile/Package.rs:3457-3478`
performs `bytes.copy_from_slice(&stream.buffer[stream.pos..stream.pos + bytes.len()])`
into `column_bytes_mut::<Meta>()`, then immediately at 3472 reborrows the
column as `&mut [Meta]` via `sliced.items_mut::<"meta", Meta>()` and iterates
calling `meta.needs_update()` — which is `self.has_install_script == HasInstallScript::Old`,
triggering the derived `PartialEq` discriminant compare on attacker-controlled
bytes.  This is the exact pattern the prior miri trace minimized.

**EXP-005 — `yarn.rs` uninit `&mut [Dependency]` slice** — STILL APPLIES.

`src/install/yarn.rs:918-925` quote:

```rust
let dependencies_base_ptr = this.buffers.dependencies.as_mut_ptr();
let resolutions_base_ptr = this.buffers.resolutions.as_mut_ptr();
let mut dependencies_buf: &mut [Dependency] = unsafe {
    // SAFETY: capacity >= num_deps reserved above
    bun_core::ffi::slice_mut(dependencies_base_ptr, num_deps as usize)
};
```

The SAFETY comment is *capacity*-focused; the **uninit** problem is not
discharged. `bun_core::ffi::slice_mut` has the same safety contract as
`slice::from_raw_parts_mut`: the memory must already contain initialized
`Dependency` values. It does not; the code is preparing to write them later.
`Dependency` also contains a closed `DependencyVersionTag` (`#[repr(u8)]`, 10
valid discriminants), so arbitrary uninitialized bytes are not valid
`Dependency` values. Shape unchanged from prior pass.

**EXP-006 — `Meta::origin` enum-from-disk** — STILL APPLIES; now
standalone Miri-confirmed by `experiments/EXP-006` (raw log:
`phase5_experiment_results/EXP-006.log`).

`src/install/lib.rs:1128-1135` quote:

```rust
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum Origin {
    #[default]
    Local = 0,
    Npm = 1,
    Tarball = 2,
}
```

`Origin` is the first field of `Meta` (`lockfile/Package/Meta.rs:13-37`),
which is one of the columnar `PackageField` entries copied verbatim from
`stream.buffer` in `Package::load_fields`.  Bytes 3..=255 produce invalid
discriminants — identical UB pattern to `HasInstallScript`. Miri reports
`constructing invalid value of type Origin: at .<enum-tag>, encountered 0x2a`.

**EXP-007 — `Tree.rs` `get_unchecked` over attacker-derived index** — STILL
APPLIES; now standalone Miri-confirmed by `experiments/EXP-007` (raw log:
`phase5_experiment_results/EXP-007.log`).

`src/install/lockfile/Tree.rs:1014-1020` quote:

```rust
for i in 0..this_deps_len {
    // SAFETY: `i < this_deps_len` and `builder.list` is not mutated until after this loop
    // (see invariant above), so `this_deps_ptr[0..this_deps_len)` remains valid.
    let dep_id: DependencyID = unsafe { *this_deps_ptr.add(i) };
    // SAFETY: `dep_id` was produced by the same lockfile that produced `deps`;
    // Zig release builds have no bounds check here.
    let dep = unsafe { deps.get_unchecked(dep_id as usize) };
```

The standalone mirror reports UB at `deps.get_unchecked(dep_id as usize)`:
``assume` called with `false`` when `dep_id >= deps.len()`.

The SAFETY comment is honest about the contract: it trusts that the lockfile
that produced `deps` also bounded all `dep_id` values.  Under adversarial
`bun.lockb` bytes, this is not true — `dep_id` is just the bytes at the right
offset.  PUB-INSTALL-4 still applies.

### New ceiling-class anchor candidate (recommend a new EXP entry)

**Buffers.rs:104-178 `read_array<T: Copy>`** is a separate typed-array
lockfile chokepoint, not the fix point for every PUB-INSTALL anchor. It does
not load the `Meta` package columns (EXP-003/006), it does not create the
yarn uninitialized slice (EXP-005), and it does not bounds-check Tree
dependency IDs (EXP-007). Its own strongest current witness is
`Vec<PatchedDep>`: `PatchedDep` contains a Rust `bool`, so arbitrary disk bytes
outside `{0,1}` violate type validity when viewed as `&[PatchedDep]`.

A defensive `unsafe trait LockfileArrayElem` bound would still be valuable for
the arrays that do flow through `read_array<T>`, but it is not a one-stroke fix
for EXP-003/005/006/007.

### Other patterns

- **`unreachable_unchecked` reachability** — 3 sites (PackageManagerTask.rs:284/542,
  Tree.rs:1131). Each one is inside a `match` arm whose discriminant is
  user-derived via a parser. Phase 2 should hand-trace the upstream `match`
  exhaustiveness for each.
- **`MaybeUninit::uninit().assume_init()` for `[u8; N]`/`[u32; N]`** — sound
  by validity (every bit pattern is valid for the element), but Phase 2 should
  spot-check that no `Drop` impl on the array's elements is ever invoked
  (e.g. confirm the elements are `Copy` arrays of primitives, not arrays of
  `MaybeUninit<NonZero*>` or similar).  Sample seen at Tree.rs:91 is `[u32; N]`
  → sound; isolated_install.rs:2049 is over a typed `MaybeUninit<T>` where the
  caller has filled every slot — needs reading.
- **HARDLINK_QUEUE atomic publication** (PackageInstall.rs:541-593) — the
  cross-thread story is well-documented but the `Relaxed` ordering on the
  `INITIALIZED` swap is bracketed by claim that the ThreadPool's Release/Acquire
  on its task queue is the actual publication edge. Phase 2 should verify by
  re-reading `bun_threading::ThreadPool::schedule` to confirm Release semantics.
- **`mem::forget(mem::take(&mut header_builder.content))`** (NetworkTask.rs:588/783)
  — intentional Drop-skip; the value is then `into_raw`-pulled into the HTTP
  request body.  Phase 2 should confirm the HTTP body's eventual `drop` runs
  on the same allocator (mimalloc) — pairing OK because both go through
  `bun_core::heap`.

## Open questions

1. **Does `load_fields` (Package.rs:3439) ever return Err with the column tail
   still uninit?**  Each per-field range check at 3464 returns Err before
   writing, but if a fallible read appears mid-field in a future change, the
   set_len-then-Drop window opens.
2. **`bin::Tag` (bin.rs:543) reachability** — is it ever read directly from
   `stream.buffer` or always rebuilt via a checked match?
3. **`auto_installer.rs:213` `&mut *(*pm).lockfile`** — the pattern is a
   classic borrowck-bypass.  Phase 2 needs to confirm no other live `&mut
   PackageManager` exists during the bridge call (the SAFETY note asserts
   "disjoint from `string_builder`'s borrow" but borrowck can't check it).
4. **`unreachable_unchecked` exhaustiveness** for the 3 sites.
5. **`PreinstallState` reachability** (resolver_hooks.rs:1228) — does it ever
   round-trip through disk bytes via manifest cache?

## Anchor cross-refs

- **EXP-003** — Anchored, **still applies**.  Shape unchanged at
  `src/install/lockfile/Package/Meta.rs:39-46`.  Read path:
  `src/install/lockfile/Package.rs:3466-3478` columnar memcpy + immediate
  `items_mut::<"meta", Meta>()` iter calling `meta.needs_update()`.
- **EXP-005** — Anchored, **still applies**.  Shape unchanged at
  `src/install/yarn.rs:918-925`.  `bun_core::ffi::slice_mut` constructs a
  `&mut [Dependency]` of length `num_deps` over uninit backing memory.
- **EXP-006** — Anchored, **still applies and Miri-confirmed**. Shape
  unchanged at `src/install/lib.rs:1128-1135`. Same memcpy path as EXP-003
  (`Origin` is field 0 of `Meta`).
- **EXP-007** — Anchored, **still applies and Miri-confirmed**. Shape
  unchanged at `src/install/lockfile/Tree.rs:1014-1020`.
  `deps.get_unchecked(dep_id as usize)` over attacker-derived `dep_id`.
- **NEW EXP candidate** — `src/install/lockfile/Buffers.rs:104-178`,
  `read_array<T: Copy>`, with `Vec<PatchedDep>` as the current strongest
  validity witness because `PatchedDep` contains a disk-backed `bool`.
  Recommend opening a new EXP id after the existing EXP-014..016 entries.
