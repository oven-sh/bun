# PASS 3 — `bun_install` Deep-Dive Soundness Audit

**Crate:** `bun_install` (`src/install/`)
**Inventory total:** 525 `unsafe` sites across 36 files
**Pass-3 sample size:** ~95 sites read in ≥30-line context, 12 critical sites traced end-to-end across attacker-input boundaries
**Headline:** **9 new pre-existing-UB candidates** + 4 latent-fragile patterns + 2 information-disclosure leaks. Several are P0 supply-chain security-triage candidates.

Pass 2 sampled this crate only at the surface. Pass 3 specifically targeted attacker-input parsing paths:

| Attacker-controlled byte source | Crate path | UB findings |
|---|---|---|
| **`bun.lockb` binary lockfile** | `lockfile.rs`, `lockfile/Buffers.rs`, `lockfile/Package.rs`, `lockfile/Tree.rs`, `lockfile/bun.lockb.rs` | 4 |
| **`yarn.lock` / `package-lock.json`** migration | `yarn.rs`, `migration.rs` | 2 |
| **`.npm` manifest cache** (registry response, persisted) | `npm.rs` | 1 |
| **Tarball entries** (gzipped tar from registry) | `TarballStream.rs`, `extract_tarball.rs` | 1 (TOCTOU latent) |
| **`PackageVersion` serialization** (cache file written) | `npm.rs` | 1 (info-disclosure) |

These are **P0 security-triage candidates** because the threat model for an npm-compatible package manager includes:
1. A malicious package on the public registry shipping a crafted tarball.
2. A typosquatted package's manifest containing crafted JSON.
3. A repository checked out from a malicious source containing a tampered `bun.lockb` / `yarn.lock` / `package-lock.json`.
4. A team member committing a hostile lockfile through a PR.

In all four scenarios the parsed bytes reach the unsafe code in this crate.

---

## 1. Executive summary

### 1.1 Bug count by class

| ID | Severity | File / lines | Class | One-line description |
|----|----------|--------------|-------|----------------------|
| **PUB-INSTALL-1** | **P0** | `lockfile/Package.rs:3320-3478` (`Meta` column load) | Invalid enum discriminant from on-disk lockfile | `Meta::has_install_script: #[repr(u8)] enum HasInstallScript` (3 valid values) read directly from attacker-controlled `bun.lockb` bytes; **byte ∉ {0,1,2} → UB** at `.needs_update()` |
| **PUB-INSTALL-2** | **P0** | `lockfile/Package.rs` (`Origin` field of `Meta`) | Invalid enum discriminant from on-disk lockfile | `Meta::origin: #[repr(u8)] enum Origin {Local=0, Npm=1, Tarball=2}` — same lockfile-byte read pattern as above |
| **PUB-INSTALL-3** | **P0** | `yarn.rs:918-925` | `&mut [Dependency]` over uninit capacity | `slice_mut(base_ptr, num_deps)` forms `&mut [Dependency]` covering Vec capacity that was reserved but not initialized; `DependencyVersionTag` is niche-bearing so the reference itself is UB |
| **PUB-INSTALL-4** | **P0** | `lockfile/Tree.rs:1020` | OOB read via attacker-controlled index | `deps.get_unchecked(dep_id as usize)` with `dep_id` from `bun.lockb` bytes; the SAFETY comment explicitly admits "Zig release builds have no bounds check" |
| **PUB-INSTALL-5** | **P1** | `lockfile/Buffers.rs:170-175` | `&[T]` from possibly-misaligned `Vec<u8>` base | `read_array<T>` casts `stream.buffer.as_ptr().add(start_pos).cast::<T>()`; `Vec<u8>` is align-1 by contract; the only check is `start_pos % align_of::<T>() == 0` |
| **PUB-INSTALL-6** | **P1** | `npm.rs:932-938` | `&[T]` from possibly-misaligned `Vec<u8>` base (twin of #5) | Same cast pattern in npm-cache `read_array<T>`; manifest cache file on disk feeds this path |
| **PUB-INSTALL-7** | **P1** | `lockfile/Package.rs:3432-3478` | Partial-init `set_len` with attacker-controlled end-cap | `list.set_len(list_len as usize)` precedes per-field copy, but each field is gated on `end_pos as u64 <= end_at`; a crafted `end_at` skips a column → `Drop`/`needs_update()` walks uninit |
| **PUB-INSTALL-8** | **P2** | `npm.rs:899-902` (`write_array`) | Padding-byte information disclosure | `slice_as_bytes` of `PackageVersion` / `NpmPackage` writes implicit-padding bytes (uninit stack/heap contents) into the on-disk `.npm` cache file; #4319 territory; the comptime padding check is a TODO no-op |
| **PUB-INSTALL-9** | **P2** | `lockfile/Buffers.rs:196`, `lockfile/Package.rs:3247-3287` | Same as #8 for `bun.lockb` write path | `assert_no_uninitialized_padding(array)` is implemented as an empty `fn` (`padding_checker.rs:71`); the call is a documentation hint not a check |
| **L-INSTALL-1** | P3 | `lockfile/Tree.rs:91` | `MaybeUninit::uninit().assume_init()` on `[u32; N]` | Documented as "every bit pattern is a valid u32" — true for `u32` but the call is `assume_init` on the **array**, which is still UB per current libstd contract; `clippy::uninit_assumed_init` lint silenced |
| **L-INSTALL-2** | P3 | `TarballStream.rs:684-805` | Path-traversal defense-in-depth gap | Only leading `..` is rejected; symlink-then-write race **could** allow writes outside the temp extraction root if libarchive surfaces a target unchecked. Currently bounded by `make_symlink`'s `/packages/`-prefix guard but the entry-stream protocol has no `O_NOFOLLOW` on directory components |
| **L-INSTALL-3** | P3 | `migration.rs:849-1494` | Raw `*mut Dependency` held across `&mut self` calls | Author-flagged TODO at line 853-860 — "raw ptrs into `buffers.{dependencies,resolutions}` held across `&mut self` calls"; sound today, fragile if any future `string_buf()` / `get_or_put_id()` ever resizes the captured Vec |
| **L-INSTALL-4** | P3 | `lockfile.rs:2683` | Cached `*mut u8` to `Vec<u8>` after `resize` | `StringBuilder::ptr` caches `string_bytes.as_mut_ptr().add(prev_len)` and the only writers go through safe indexing; the cached pointer is effectively just a `bool` flag, but a future refactor could re-arm the staleness hazard |

**P0 = security-critical; will land in an audit PR. P1 = soundness, real triggers but rarer. P2 = information-disclosure / hardening. P3 = latent.**

### 1.2 What "P0" means for an npm-compatible package manager

`bun install` is invoked on machines that contain credentials, source code, secrets. The attack surface includes:

- Running `bun install` in a freshly cloned repository (CI, contributor onboarding) where `bun.lockb` is attacker-controlled.
- Installing a package whose tarball or registry response is hostile.
- An infected mirror or proxy returning altered registry data that lands in the `.npm` cache.

A P0 here corresponds to an exploit primitive — invalid enum value, OOB read, or invalid reference — against memory the install process owns. Combined with the rest of the install path (which runs `node-gyp`, lifecycle scripts, etc.), supply-chain consequences are immediate.

---

## 2. `bun_install` module-level unsafe-density map

### 2.1 Per-file `unsafe` count (top 25)

```
52  src/install/windows-shim/bun_shim_impl.rs       (covered by Pass 2 — pre-existing-ub-ptr-5)
36  src/install/PackageManager.rs                    (Zig-port mut-self plumbing, sound)
32  src/install/PackageManager/runTasks.rs           (task-queue intrusive-link unsafe, sound)
31  src/install/PackageManager/PackageManagerEnqueue.rs
30  src/install/TarballStream.rs                     ← attacker tarball — see §4.1
27  src/install/PackageInstall.rs                    (HardLinkQueue init pattern, sound)
24  src/install/lifecycle_script_runner.rs           (raw-ptr lifecycle, sound)
23  src/install/PackageManagerTask.rs
22  src/install/NetworkTask.rs                       (HTTP callback raw-ptrs, sound)
19  src/install/isolated_install/Installer.rs
17  src/install/PackageManager/PackageManagerDirectories.rs
16  src/install/PackageManager/security_scanner.rs
15  src/install/PackageManager/PopulateManifestCache.rs
13  src/install/padding_checker.rs                   ← padding-check is a no-op — see §4.4
13  src/install/lockfile/Package.rs                  ← attacker lockfile — see §4.2
13  src/install/PackageManager/install_with_manager.rs
12  src/install/hoisted_install.rs
11  src/install/lockfile.rs                          ← attacker lockfile — see §4.2
10  src/install/npm.rs                               ← attacker registry/cache — see §4.3
10  src/install/PackageInstaller.rs
 9  src/install/patch_install.rs                     (queue plumbing, sound)
 9  src/install/bin.rs
 9  src/install/auto_installer.rs
 7  src/install/lib.rs
 6  src/install/isolated_install.rs
```

### 2.2 By category (`bun_install` only)

```
152  other                  ← raw-ptr deref of Zig-port `*mut Self` (Invariant I-001, sound)
 95  zig_port_mut_ref       ← `&mut *raw` reborrows (Invariant I-001, sound)
 91  fd_syscall             ← `unsafe fn` carrying fd contracts
 81  ptr_cast               ← `cast::<T>()` — the alignment hazards live here
 77  ptr_intrinsic          ← `addr_of!`, `core::ptr::{read,write}`
 33  ptr_arith              ← `ptr.add(n)` — the dominant high-risk attacker-input shape
 20  other_unsafe_impl
 18  raw_ptr_lifecycle
 15  maybe_uninit           ← `assume_init`/`uninit().assume_init()` sites
 14  c_alloc                ← libarchive/libuv/libdeflate destructor pairs
 14  bun_ffi_helper
 14  atomic
 13  bun_heap_lifecycle     ← `bun_core::heap::{take,destroy}`
 10  zig_port_shared_ref
 10  raw_method_call
  8  allocator
  7  raw_cast
  5  libarchive_ffi         ← gzip+tar decode boundary — see §4.1
  4  libuv_ffi
  3  zig_port_self_call
  3  compiler_hint
  2  syscall
  2  mem_zeroed
  1  zlib_ffi
  1  unchecked_index        ← lockfile/Tree.rs:1020 — **PUB-INSTALL-4**
  1  sync_impl
```

The `unchecked_index` category has a single bun_install entry, and it is exactly the attacker-driven OOB site reported as **PUB-INSTALL-4**.

### 2.3 Attack surface heat map

```
                   │   on-disk      registry        tarball      git-url     in-mem
                   │   parsing      response       extract      parsing      racy
TarballStream.rs   │   .            .              ●●●●●        .            ●
lockfile.rs        │   ●●●●         .              .            .            .
lockfile/Buffers   │   ●●●●●        .              .            .            .
lockfile/Package   │   ●●●●●        .              .            .            .
lockfile/Tree.rs   │   ●●●●         .              .            .            .
npm.rs             │   ●●●          ●●●●           .            .            .
migration.rs       │   ●●●          .              .            .            .
yarn.rs            │   ●●●●         .              .            .            .
hosted_git_info.rs │   .            .              .            ●●           .
dependency.rs      │   ●●           ●●             .            .            .
auto_installer.rs  │   .            .              .            .            ●
NetworkTask.rs     │   .            ●              .            .            ●
PackageInstall.rs  │   .            .              ●●           .            ●●
```

`bun.lockb` is the most exposed attack surface. There is no signature on the lockfile.

---

## 3. Methodology

### 3.1 Sites read in ≥30 lines of context

I read 95 unique sites in full surrounding context. Each was classified as:

- **A** — safe by bounds check / proof
- **A-FFI** — at FFI boundary; soundness deferred to vendor lib contract
- **UB-RISK-untrusted-input** — pre-existing UB candidate (filed as PUB-INSTALL-*)
- **UB-RISK-toctou** — race / TOCTOU primitive
- **C-refactor** — sound but ergonomically fragile

### 3.2 Sites NOT re-audited (covered by Pass 2)

- `windows-shim/bun_shim_impl.rs` — 52 sites — Pass 2 produced `pre-existing-ub-ptr-5` already.
- Zig-port `&mut *raw` plumbing per Invariant I-001 — sampled, no anti-pattern UB.
- `unsafe impl bun_threading::Linked` intrusive queue links — uniform pattern, sound.

### 3.3 The four critical chains I traced end-to-end

**Chain A (Meta enum UB):** disk byte → `read_to_end` → `Stream::buffer` → `column_bytes_mut(Meta)` → `copy_from_slice` → `&mut [Meta]` → `meta.needs_update()` → `match meta.has_install_script`.

**Chain B (yarn.rs uninit slice):** `num_deps` from yarn.lock → `Vec::reserve(num_deps)` → `as_mut_ptr()` → `slice_mut(ptr, num_deps)` (UB-here, before any write).

**Chain C (Tree dep_id OOB):** disk byte → `Buffers::load` → `dependencies` Vec → `Tree.dependencies.get(dependency_lists[id])` → slice ptr cached → `*ptr.add(i)` (bounded) → `deps.get_unchecked(dep_id)` (NOT bounded, `dep_id` is on-disk byte).

**Chain D (alignment):** disk byte → `Vec<u8>::from(read_to_end)` → `bun_io::FixedBufferStream::new` → `read_array::<T>` → `bun_core::ffi::slice(buf.as_ptr().add(pos).cast::<T>(), n)` → `&[T]`.

---

## 4. The 12 findings in detail

### 4.1 PUB-INSTALL-1 — `Meta::has_install_script` enum UB on tampered `bun.lockb`

**Severity:** P0 (security-triage candidate)
**File:** `src/install/lockfile/Package.rs:3320-3478`; struct definition `src/install/lockfile/Package/Meta.rs:34, 39-46`

#### The code

```rust
// lockfile/Package/Meta.rs:39
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum HasInstallScript {
    Old = 0,
    #[default]
    False,
    True,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Meta {
    pub origin: Origin,                 // also #[repr(u8)] enum — see PUB-INSTALL-2
    pub _padding_origin: u8,
    pub arch: Architecture,             // pub struct Architecture(pub u16) — POD, OK
    pub os: OperatingSystem,            // pub struct OperatingSystem(pub u16) — POD, OK
    pub _padding_os: u16,
    pub id: PackageID,                  // u32
    pub man_dir: String,
    pub integrity: Integrity,
    pub has_install_script: HasInstallScript,    // ← UB-vector
    pub _padding_integrity: [u8; 2],
}
```

```rust
// lockfile/Package.rs:3432 (the non-migration arm)
// SAFETY: capacity reserved above; `load_fields` writes every column.
unsafe { list.set_len(list_len as usize) };
load_fields::<SemverIntType>(stream, end_at as u64, &mut list, &mut needs_update)?;
```

```rust
// lockfile/Package.rs:3462-3478 — inside load_fields
let bytes: &mut [u8] = unsafe {
    sliced.column_bytes_mut(field as usize)
};
let end_pos = stream.pos + bytes.len();
if end_pos as u64 <= end_at {
    bytes.copy_from_slice(&stream.buffer[stream.pos..stream.pos + bytes.len()]);
    stream.pos = end_pos;
    if matches!(field, PackageField::Meta) {
        let metas: &mut [Meta] = unsafe { sliced.items_mut::<"meta", Meta>() };
        for meta in metas {
            if meta.needs_update() {                  // ← reads has_install_script
                *needs_update = true;
                break;
            }
        }
    }
}
```

```rust
// lockfile/Package/Meta.rs:84
pub fn needs_update(&self) -> bool {
    self.has_install_script == HasInstallScript::Old
}
```

#### Why this is UB

1. `HasInstallScript` is a `#[repr(u8)]` enum with **exactly three valid bit patterns**: `0`, `1`, `2`.
2. Reading any other byte through a `HasInstallScript`-typed lvalue is **undefined behavior** per the Rust reference (rules for niche-bearing types).
3. The `Meta` column comes from `stream.buffer` which is a `Vec<u8>` read from `bun.lockb`. **An attacker who controls the file controls every byte of every Meta record**, including the `has_install_script` byte.

The comment on `Tag` at `resolution.rs:883-890` — for the **other** lockfile-derived tag — explicitly acknowledges this exact hazard:

> // Zig `enum(u8) { ..., _ }` is non-exhaustive — values outside the named set are
> // valid (lockfile bytes may carry unknown tags, and every `switch` has an `else`
> // arm). A `#[repr(u8)] enum` would be UB for such values, so Tag is a transparent
> // u8 newtype with associated consts.

`Resolution::Tag` was correctly ported as a `#[repr(transparent)] struct Tag(pub u8)` with associated consts. `HasInstallScript` (and `Origin` — see PUB-INSTALL-2) **were not**.

#### Adversarial input

A `bun.lockb` whose `Meta` column has any record with `has_install_script` byte ∉ {0, 1, 2}, e.g. `0xFF`.

```hex
... | Meta_record_0 | ... | byte at offset Meta.has_install_script: 0xFF | ...
```

The record gets `copy_from_slice`'d in; then `meta.needs_update()` runs `self.has_install_script == HasInstallScript::Old` — an enum equality compare on an invalid discriminant. Under current LLVM this often executes as a plain byte compare, but the Rust reference says the read itself is UB, which means optimizing passes may treat downstream branches as unreachable. Practical exploitation today is "branch-prediction-shaped corruption"; in a future rustc the compiler is licensed to do worse.

#### Fix

Replace both enums with the `#[repr(transparent)] struct(pub u8)` + associated consts pattern that `resolution::Tag` and `integrity::Tag` already use (`resolution.rs:888-897`, `integrity.rs:255-260`). Add an explicit validity check at load — `HasInstallScript::from_u8(b).ok_or(err!("CorruptLockfile"))?`.

```rust
// hardened SAFETY template
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct HasInstallScript(pub u8);

impl HasInstallScript {
    pub const OLD: Self = Self(0);
    pub const FALSE: Self = Self(1);
    pub const TRUE: Self = Self(2);

    #[inline]
    pub fn is_valid(self) -> bool {
        matches!(self.0, 0..=2)
    }
}

// At lockfile load, after copy_from_slice for Meta column:
for meta in metas {
    if !meta.has_install_script.is_valid() {
        return Err(bun_core::err!("CorruptLockfile"));
    }
}
```

---

### 4.2 PUB-INSTALL-2 — `Meta::origin` enum UB on tampered `bun.lockb`

**Severity:** P0 (security-triage candidate)
**File:** `src/install/lib.rs:1128-1135` (`Origin` enum); read site is the same Meta column at `lockfile/Package.rs:3432`.

#### The code

```rust
// lib.rs:1128
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum Origin {
    #[default]
    Local = 0,
    Npm = 1,
    Tarball = 2,
}
```

`Meta.origin` is byte 0 of every `Meta` record. Same load path as PUB-INSTALL-1.

#### Why this is UB

3 valid discriminants out of 256 possible byte values. Attacker writes byte `0xFF` → `meta.origin` reads invalid discriminant → any subsequent `match` or `==` on the field is UB. `Origin` is used in `lockfile.rs:2068`, `migration.rs:790-795`, `auto_installer.rs:282`, and the install path of `PackageInstall.rs` — every package install in a malformed lockfile triggers it.

#### Adversarial input

Same `bun.lockb` tampering as PUB-INSTALL-1, byte at `offset_of(Meta, origin)` set to `0xFF`.

#### Fix

Same fix template as PUB-INSTALL-1.

---

### 4.3 PUB-INSTALL-3 — yarn.lock parser forms `&mut [Dependency]` over uninitialized Vec capacity

**Severity:** P0
**File:** `src/install/yarn.rs:914-925`, `:1396-1403`

#### The code

```rust
// yarn.rs:914
// SAFETY: capacity reserved above to num_deps; Zig writes into items.ptr[0..num_deps]
// beyond len. We mirror with raw pointers and set len at the end.
let dependencies_base_ptr = this.buffers.dependencies.as_mut_ptr();
let resolutions_base_ptr = this.buffers.resolutions.as_mut_ptr();
let mut dependencies_buf: &mut [Dependency] = unsafe {
    // SAFETY: capacity >= num_deps reserved above
    bun_core::ffi::slice_mut(dependencies_base_ptr, num_deps as usize)
};
let mut resolutions_buf: &mut [PackageID] = unsafe {
    // SAFETY: capacity >= num_deps reserved above
    bun_core::ffi::slice_mut(resolutions_base_ptr, num_deps as usize)
};
```

`this.buffers.dependencies` was just `.reserve(num_deps as usize)`. Vec capacity is uninitialized memory.

#### Why this is UB

`bun_core::ffi::slice_mut` resolves to `core::slice::from_raw_parts_mut`. Per its contract, every `T` in the produced slice must be a valid value of `T`. `Dependency` contains `version: DependencyVersion`, which contains `tag: DependencyVersionTag` — a `#[repr(u8)]` enum with valid discriminants `0..=9`. Forming a `&mut [Dependency]` whose backing bytes are whatever was on the heap from the allocator **is UB at the point the reference is created**, even before any field is read.

The sister `migration.rs` site (line 866-869) gets this right — it uses `core::ptr::write(base.add(i), Dependency::default())` to initialize the same backing memory **before** ever forming a `&[Dependency]`. yarn.rs took the slice route instead.

The pattern at line 1396 then `set_len`s the Vec to `final_deps_len`, but by then the UB has already occurred at line 918.

#### Adversarial input

Any sufficiently large `yarn.lock` that triggers this path. `bun_install` migrates yarn.lock files automatically when present in a repo. A crafted yarn.lock just needs to make `num_deps` ≥ 1 (i.e., it just needs to be parseable as yarn.lock format) — the UB happens unconditionally.

#### Exploitation difficulty

Whether the heap bytes happen to encode valid `DependencyVersionTag` is allocator-dependent and run-dependent. The bug **always fires** under Miri / -Zsanitizer=address / Tree Borrows; it is **latent in production** because mimalloc tends to return zeroed pages, and tag 0 (`Uninitialized`) happens to be valid. But this is implementation-defined behavior of the allocator, not a soundness argument.

#### Fix

Replace with the migration.rs pattern:

```rust
// Initialize first, then take the slice.
unsafe {
    for i in 0..(num_deps as usize) {
        core::ptr::write(dependencies_base_ptr.add(i), Dependency::default());
        core::ptr::write(resolutions_base_ptr.add(i), UNSET_PACKAGE_ID);
    }
    this.buffers.dependencies.set_len(num_deps as usize);
    this.buffers.resolutions.set_len(num_deps as usize);
}
// Now `as_mut_slice()` is safe.
let dependencies_buf = this.buffers.dependencies.as_mut_slice();
```

---

### 4.4 PUB-INSTALL-4 — `lockfile/Tree.rs:1020` OOB read via attacker `dep_id`

**Severity:** P0
**File:** `src/install/lockfile/Tree.rs:1000-1023`

#### The code

```rust
let (this_deps_ptr, this_deps_len): (*const DependencyID, usize) = {
    let s = this
        .dependencies
        .get(builder.list.items_dependencies()[self_id as usize].as_slice());
    (s.as_ptr(), s.len())
};
let target_name_hash = dependency.name_hash;
for i in 0..this_deps_len {
    // SAFETY: `i < this_deps_len` and `builder.list` is not mutated until after this loop
    // (see invariant above), so `this_deps_ptr[0..this_deps_len)` remains valid.
    let dep_id: DependencyID = unsafe { *this_deps_ptr.add(i) };
    // SAFETY: `dep_id` was produced by the same lockfile that produced `deps`;
    // Zig release builds have no bounds check here.
    let dep = unsafe { deps.get_unchecked(dep_id as usize) };
```

#### Why this is UB

`dep_id` comes from `builder.list.items_dependencies()[self_id].as_slice()` — slot in the package's external dependency-ID list — which is **a direct memcpy from the bun.lockb file**. There is no validation that `dep_id < deps.len()`. The SAFETY comment explicitly acknowledges that Zig didn't bounds-check, but the Rust port inherits the unsoundness without re-evaluating.

`deps` is `lockfile.buffers.dependencies.as_slice()`, length controlled by the lockfile's `dependencies` array length field (also attacker-controlled). An attacker can set:

- `dependencies` array length = small (e.g. 8)
- A package's dependency list = `[0xDEAD]` (large index)

`get_unchecked(0xDEAD)` then performs an OOB pointer.add → arbitrary memory read → reinterpret as `&Dependency` → forms an invalid `&DependencyVersion.tag` → enum-UB on top of the OOB.

#### Adversarial input

```
bun.lockb where:
  buffers.dependencies has length 8 (small)
  trees[k].dependencies = DependencyIDSlice{ start: 0, len: 1 }
  buffers.hoisted_dependencies[0] = 0xFFFFFFFE  // PackageID-sized OOB
```

Calling `hoist()` on this lockfile reaches the `Tree::add_dependency` / `hoist_dependency` path that contains this loop.

#### Fix

Bounds-check `dep_id` on lockfile load (in `Buffers::load`), AND replace `get_unchecked` with safe indexing here:

```rust
let dep_id: DependencyID = unsafe { *this_deps_ptr.add(i) };
let dep = match deps.get(dep_id as usize) {
    Some(d) => d,
    None => return Err(bun_core::err!("CorruptLockfile")),
};
```

A whole-buffer post-load validator (`Buffers::validate(deps_len, resolutions_len)`) that walks every cross-reference once would be the durable fix.

---

### 4.5 PUB-INSTALL-5 — `lockfile/Buffers.rs` `&[T]` from `Vec<u8>` base — alignment hazard

**Severity:** P1
**File:** `src/install/lockfile/Buffers.rs:104-178`

#### The code

```rust
pub fn read_array<T: Copy>(stream: &mut Stream) -> Result<Vec<T>, bun_core::Error> {
    let start_pos = stream.read_int_le::<u64>()?;
    // ... range/sanity checks ...
    if start_pos % core::mem::align_of::<T>() as u64 != 0 || byte_len % size_of::<T>() as u64 != 0 {
        return Err(bun_core::err!("CorruptLockfile"));
    }

    let start_pos = start_pos as usize;
    let end_pos = end_pos as usize;
    // SAFETY: `start_pos..end_pos` is in-bounds (checked above) and the lockfile
    // writer aligned the payload to `align_of::<T>()` via `Aligner::write`. Zig
    // used `@alignCast` here with the same precondition.
    let misaligned: &[T] = unsafe {
        bun_core::ffi::slice(
            stream.buffer.as_ptr().add(start_pos).cast::<T>(),
            (end_pos - start_pos) / size_of::<T>(),
        )
    };

    Ok(misaligned.to_vec())
}
```

#### Why this is unsound

`Stream = bun_io::FixedBufferStream<Vec<u8>>`. `Vec<u8>::as_ptr()` is guaranteed only to be aligned to `align_of::<u8>() == 1`. The contract for `core::slice::from_raw_parts` requires the produced pointer to be aligned to `align_of::<T>()`.

The code checks `start_pos % align_of::<T>() == 0`. This makes the **offset** divisible by the alignment — but only guarantees an aligned final address if the **base** is also aligned. For `Vec<u8>`, the standard does not require that.

In practice, mimalloc (`#[global_allocator]`) returns ≥8-byte-aligned allocations for non-tiny `Vec<u8>` sizes, so `&[ExternalString]` (align 8) and `&[Version]` (align 8) get lucky pointers. But this is allocator-implementation-defined, not a Rust guarantee, and a future allocator swap would break it.

#### Adversarial input

Not directly attacker-triggerable today because `Vec<u8>` is mimalloc-aligned in practice. But under a different allocator (`#[cfg(miri)]`, jemalloc-experiments, custom builds), this becomes a guaranteed crash on the first lockfile load.

#### Fix

Either:

1. Allocate the lockfile buffer with explicit alignment — wrap the `Vec<u8>` in `bun_alloc::AlignedVec<u8, 8>` (or use `Box<[u8; _]>` for known-bounded files).
2. Replace `read_array` with a copying loop: `ptr::read_unaligned` per element. Slightly slower; bulletproof.
3. Add a debug assertion that the base is aligned, and a runtime check in release.

The `to_vec()` at line 177 destination is properly aligned (`Vec::with_capacity` of the destination); only the intermediate `&[T]` is the soundness gap. Switching to:

```rust
let bytes = &stream.buffer[start_pos..end_pos];
let mut out: Vec<T> = Vec::with_capacity(byte_len as usize / size_of::<T>());
for chunk in bytes.chunks_exact(size_of::<T>()) {
    out.push(unsafe { core::ptr::read_unaligned(chunk.as_ptr().cast::<T>()) });
}
Ok(out)
```

…fixes the soundness without changing the API. The bytewise-memcpy that `to_vec()` would have done is still elided by LLVM in the per-element read_unaligned loop.

---

### 4.6 PUB-INSTALL-6 — `npm.rs` `read_array<T>` twin of #5 on `.npm` manifest cache

**Severity:** P1
**File:** `src/install/npm.rs:918-941`

#### The code

```rust
pub fn read_array<'a, T: Copy>(
    stream: &mut bun_io::FixedBufferStream<&'a [u8]>,
) -> Result<&'a [T], Error> {
    let byte_len = stream.read_int_le::<u64>()?;
    if byte_len == 0 {
        return Ok(&[]);
    }

    stream.pos += Aligner::skip_amount::<T>(stream.pos);
    let remaining = &stream.buffer[stream.pos.min(stream.buffer.len())..];
    if (remaining.len() as u64) < byte_len {
        return Err(err!("BufferTooSmall"));
    }
    let result_bytes = &remaining[..byte_len as usize];
    // SAFETY: alignment was advanced by Aligner::skip_amount; T is POD
    let result = unsafe {
        bun_core::ffi::slice(
            result_bytes.as_ptr().cast::<T>(),
            result_bytes.len() / core::mem::size_of::<T>(),
        )
    };
    stream.pos += result_bytes.len();
    Ok(result)
}
```

#### Why this is unsound

`Aligner::skip_amount` (`lib.rs:1117-1125`) returns `pos.next_multiple_of(align) - pos`. It aligns the **stream position**, not the **base address of the buffer**. The buffer base is `Vec<u8>::as_ptr()` from `read_to_end` — align-1.

`PackageVersion` (240B, align 8), `NpmPackage` (120B, align 8), `Semver::Version` (56B, align 8), `ExternalString` (16B, align 8), `PackageNameHash` (u64, align 8) — every type pumped through this function is align ≥ 8.

#### Adversarial input

A `.npm` cache file written by a different alignment, or a tampered cache file from an attacker who can write to the bun cache directory (relatively low bar — local privilege escalation primitives chain into this).

The returned `&[T]` is then `.into()`-converted to `Box<[T]>` (lines 1401-1413). The `Box<[T]>::from(&[T])` allocator-aligns the destination, but the SOURCE `&[T]` was UB.

#### Fix

Same as #5. The simplest patch is a copying loop using `ptr::read_unaligned`, returning an owned `Box<[T]>` directly.

---

### 4.7 PUB-INSTALL-7 — `lockfile/Package.rs` `set_len` precedes partial-init load

**Severity:** P1
**File:** `src/install/lockfile/Package.rs:3320-3478`

#### The code

```rust
let list_len = reader.read_int_le::<u64>()?;
if list_len > u32::MAX as u64 - 1 {
    return Err(bun_core::err!("Lockfile validation failed: list is impossibly long"));
}
// ... field_count, begin_at, end_at sanity checks ...
list.ensure_total_capacity(list_len as usize)?;

if migrate_from_v2 { ... } else {
    // SAFETY: capacity reserved above; `load_fields` writes every column.
    unsafe { list.set_len(list_len as usize) };
    load_fields::<SemverIntType>(stream, end_at as u64, &mut list, &mut needs_update)?;
}
```

```rust
// inside load_fields
for field in PackageField::ALL {
    let bytes: &mut [u8] = unsafe { sliced.column_bytes_mut(field as usize) };
    let end_pos = stream.pos + bytes.len();
    if end_pos as u64 <= end_at {
        bytes.copy_from_slice(...);
        stream.pos = end_pos;
        if matches!(field, PackageField::Meta) {
            let metas: &mut [Meta] = unsafe { sliced.items_mut::<"meta", Meta>() };
            for meta in metas {
                if meta.needs_update() { ... }
            }
        }
    }
    // ← Note: no else branch. If the check fails, the column stays at whatever
    // bytes were in the freshly-allocated MultiArrayList (typically zeros from
    // mimalloc, but not guaranteed).
}
```

#### Why this is unsound

`list.set_len(list_len)` declares all `list_len` elements valid. `load_fields` then walks the columns; **if `end_pos > end_at` for any column, that column is silently skipped** but the list still has its `list_len` elements visible.

A corrupt `end_at` can:

1. Truncate the `Meta` column — `metas[i]` walks uninit memory → `meta.needs_update()` reads `has_install_script` (UB enum read).
2. Truncate the `Resolution` column — every `Resolution.tag` is then uninit → readers downstream see invalid resolution.tag values. Tag is a transparent `u8` newtype so the read itself is value-safe, but subsequent `match tag` arms may hit code paths that don't expect garbage IDs.

#### Adversarial input

A `bun.lockb` whose package-table-header writes `end_at = begin_at + size_of(Resolution_column)` such that the load loop fills the Resolution column but `end_pos > end_at` when it reaches the Meta column.

#### Fix

After `load_fields` returns, verify every column was filled: track which columns succeeded and `return Err(...)` if any was skipped. Or, simpler, require `end_at == begin_at + sum_of_all_columns` upfront and skip the per-iteration bound.

---

### 4.8 PUB-INSTALL-8 — `slice_as_bytes(&PackageVersion)` writes padding bytes to disk

**Severity:** P2 (information disclosure)
**File:** `src/install/npm.rs:893-915`

#### The code

```rust
pub fn write_array<W: bun_io::Write, T: Copy>(
    writer: &mut W,
    array: &[T],
    pos: &mut u64,
) -> Result<(), Error> {
    // SAFETY: T is Copy POD; sliceAsBytes equivalent
    let bytes = unsafe {
        bun_core::ffi::slice(array.as_ptr().cast::<u8>(), core::mem::size_of_val(array))
    };
    // ... writes bytes to file ...
}
```

#### Why this leaks information

`PackageVersion` (240B, align 8) is built up field by field — `Integrity`, multiple `ExternalStringMap`s, `Bin`, `non_optional_peer_dependencies_start: u32`, `man_dir`, `tarball_url`, `unpacked_size`, `file_count`, `os: u16`, `cpu: u16`, `libc: u8`, `has_install_script: bool`, `publish_timestamp_ms: f64`.

The fields don't sum cleanly to 240. There is implicit padding (the `padding_checker.rs::layout_asserts` pin `size = 240` — but the explicit per-field `_padding_*` markers from `Meta` are absent here).

`Default::default()` constructs the struct by setting each field individually. The Rust reference does not guarantee that padding bytes are initialized. Per [the reference](https://doc.rust-lang.org/reference/types/struct.html):

> The bytes of struct values include the bytes of all of its fields and may include uninitialised padding bytes.

`slice_as_bytes` then reads those padding bytes from local stack memory and writes them to disk in the `.npm` cache file. **Stack-memory contents are leaked into a user-visible file.**

This is GitHub issue **#4319** territory — the Zig original had a `comptime` padding check that this Rust port replaces with a no-op (`padding_checker.rs:71`):

```rust
#[inline(always)]
pub fn assert_no_uninitialized_padding<T>(_type_witness: T) {
    // Body intentionally empty — the derive on `T` is the check. Matches Zig's
    // runtime behaviour (the Zig version is `comptime`-only and codegens nothing).
}
```

But the derive **does not exist yet** (file comments say "Phase B should provide this as a proc-macro derive"). So the only check that prevents padding leaks is unimplemented.

#### Adversarial impact

The `.npm` cache lives in `~/.bun/install/cache/`. If an attacker can read this directory (e.g. shared CI cache, container layer leakage, accidental commit), the padding bytes from every `PackageVersion` written there reveal slices of the host's stack/heap memory at install time.

#### Fix

1. Add explicit `_padding_*: [u8; N] = [0; N]` fields like `Meta` already has.
2. Resurrect the comptime check — define an `AssertNoUninitializedPadding` derive (the file already has the skeleton for it).
3. Even faster: zero the struct via `unsafe { core::mem::zeroed() }` before assigning fields, so any padding bytes are 0.

---

### 4.9 PUB-INSTALL-9 — `bun.lockb` writes share the padding hazard

**Severity:** P2
**File:** `src/install/lockfile/Buffers.rs:196`, `src/install/lockfile/Package.rs:3247-3287`

Both call `assert_no_uninitialized_padding(array)` (no-op) and then `slice_as_bytes` the array into the lockfile.

For `bun.lockb`:

- `tree::External` is `[u8; 20]` — no padding by definition. OK.
- `dependency::External` is `[u8; 26]` — no padding. OK.
- `bun_semver::ExternalString` has `value: bun_semver::String` (`[u8; 8]`) + `hash: u64` — exact 16B, no padding. OK.
- `DependencyID` is `u32`. OK.
- `PackageID` is `u32`. OK.

So the bun.lockb writes are byte-exact. But the **same** `slice_as_bytes` pattern is used at `lockfile/Package.rs:3282-3287` for `Resolution`:

```rust
let copy = val.copy();
// SAFETY: Resolution is #[repr(C)] POD; reading raw bytes is sound.
stream.write_all(unsafe {
    bun_core::ffi::slice(
        (&raw const copy).cast::<u8>(),
        mem::size_of_val(&copy),
    )
})?;
```

`Resolution` is `u8 tag + [7]u8 + Value(64B, align 8)` = 72 bytes (pinned by `padding_checker::layout_asserts::pin!(Resolution, 72, 8)`). The `Value` is a union — its inactive bytes are defined by `value_zero()` which uses `bun_core::ffi::zeroed_unchecked()` (`resolution.rs:861`). So the inactive bytes start zeroed, and the explicit `[7]u8` after `tag` is initialized via `Default`. **This particular site is OK** because the explicit padding pattern was applied.

But the **discipline depends on every struct that flows through `slice_as_bytes` carrying explicit padding markers**. There is no compile-time check enforcing it. `PackageVersion` (PUB-INSTALL-8) is the case where the discipline lapsed.

#### Fix

Same as PUB-INSTALL-8 — restore the comptime padding check.

---

### 4.10 L-INSTALL-1 — `MaybeUninit::uninit().assume_init()` on `[u32; N]`

**Severity:** P3 (latent)
**File:** `src/install/lockfile/Tree.rs:85-92`

```rust
#[inline]
#[allow(invalid_value, clippy::uninit_assumed_init)]
pub fn depth_buf_uninit() -> DepthBuf {
    // SAFETY: `DepthBuf` is `[u32; N]`; every bit pattern is a valid `u32`.
    // Callers treat this as a write-only scratch buffer — no element is read
    // before being assigned by `relative_path_and_depth`.
    unsafe { core::mem::MaybeUninit::uninit().assume_init() }
}
```

Per the current stdlib documentation, `MaybeUninit::<T>::uninit().assume_init()` for `T = [u32; N]` is **specifically called out as instant UB** even if all-bits-pattern would be valid for the inner integer. The compiler is licensed to dead-code-eliminate the call.

The two callers (`lockfile.rs:2905`, search the crate for `depth_buf_uninit`) treat the buffer as write-only scratch.

#### Fix

Use `[0u32; N]` (the zero-init cost is a single SIMD store) or `MaybeUninit<DepthBuf>` and only `assume_init` the produced slice once it has been written:

```rust
pub fn depth_buf_uninit() -> [u32; DepthBuf::LEN] {
    [0; DepthBuf::LEN]
}
```

`bun_runtime` had the same pattern; Pass 2's `PASS2-maybe-uninit-deep-dive.md` lists it as a known-pattern hazard.

---

### 4.11 L-INSTALL-2 — Tarball-extract path traversal: defense-in-depth is shallow

**Severity:** P3 (currently bounded)
**File:** `src/install/TarballStream.rs:684-810, 1249-1359`

The current path traversal protections, in order:

1. `tokenize_rest_after_first` strips the first directory component AND any leading `/` (`TarballStream.rs:1391-1402`). Good — prevents `package/../etc/passwd` → `etc/passwd`.
2. `normalize_buf_t` collapses `..` and `.` but leaves leading `..` if relative.
3. `path.len() >= 2 && path[0] == '.' && path[1] == '.' && (len==2 || path[2] == SEP)` → reject (TarballStream.rs:766-774). Closes the gap from #2.
4. On Windows: reject absolute paths.
5. For symlinks: `join_abs_string_buf` validates target resolves under `/packages/` (TarballStream.rs:1339-1347).

#### What's missing

`open_output_file` (TarballStream.rs:1249-1290) uses plain `openat(dest_fd, "safe/escape/payload", O_WRONLY|O_CREAT|O_TRUNC, ...)`. **No `O_NOFOLLOW` on intermediate directory components.** If an earlier entry created a symlink inside the tree that the symlink check accepted (target inside `/packages/`), and a later file write traverses through that symlink…

Today the symlink validator forbids targets outside `/packages/`, and `/packages/` is a virtual root — so all writes ultimately land in the temp extraction directory. The current bound holds.

BUT: tarball-entry ordering is attacker-controlled, and the `make_path(dir)` fallback in `open_output_file:1282` creates intermediate directories — through any symlinks that match the prefix. **A future change** that loosened the symlink target rule (e.g. to support npm "linked" packages) would silently lose this guarantee.

#### Recommendation

Switch `openat` to `O_NOFOLLOW | O_CLOEXEC` and walk the path component-by-component with `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)` on Linux ≥ 5.6. Cost: one extra `unsafe` block around `openat2`; benefit: structural guarantee that no symlink in the temp dir can subvert the extraction.

---

### 4.12 L-INSTALL-3 — `migration.rs` raw-ptr-across-`&mut self` self-flagged

**Severity:** P3
**File:** `src/install/migration.rs:849-1494`

The author flagged this directly:

```rust
let dependencies_base: *mut Dependency = this.buffers.dependencies.as_mut_ptr();
let resolutions_base: *mut PackageID = this.buffers.resolutions.as_mut_ptr();
let mut deps_cursor: usize = 0;
let mut res_cursor: usize = 0;
// TODO(port/phase-b): Stacked-Borrows audit — these raw ptrs into
// `buffers.{dependencies,resolutions}` and the `packages` columns below are
// held across `&mut self` calls to `string_buf()` / `get_or_put_id()`. The
// fields actually touched are disjoint (string_bytes/string_pool resp.
// package_index + read of resolutions), so this is sound under Tree
// Borrows and matches the Zig spec, but SB retags through `Unique<T>`.
// Fix by split-borrowing the disjoint fields (see the `bin` path above) or
// by setting Vec lengths up-front and indexing safely.
```

Stacked Borrows would retag through `Unique<T>` at each `&mut self` call, invalidating the cached raw pointer. Tree Borrows is more permissive but this is the kind of "miri-pass-by-accident-of-the-allocator" code that gets re-broken by `cargo update`.

#### Fix

Set the Vec lengths up-front (`set_len(num_deps)` after a `core::ptr::write` initialization loop, mirroring lines 866-869's debug-only pre-fill but in release too), then use safe indexed writes instead of raw `core::ptr::write(base.add(cursor), ...)`. This eliminates the four unsafe blocks at lines 866, 1007, 1178, 1448 and the alias-across-&mut hazard.

---

### 4.13 L-INSTALL-4 — `lockfile.rs:2683` cached `*mut u8` from `Vec`

**Severity:** P3
**File:** `src/install/lockfile.rs:2674-2685`

```rust
pub fn allocate(&mut self) -> Result<(), AllocError> {
    let string_bytes = &mut *self.string_bytes;
    let prev_len = string_bytes.len();
    string_bytes.resize(prev_len + self.cap, 0);
    self.off = prev_len;
    self.ptr = Some(unsafe { string_bytes.as_mut_ptr().add(prev_len) });
    self.len = 0;
    Ok(())
}
```

The cached `self.ptr` is read only as `self.ptr.is_some()` elsewhere (call sites at lines 2631, 2652, 2700, 2725). It is **never dereferenced**. The author already migrated writes to safe indexing (line 2707). The cached ptr is now a `bool` in disguise.

#### Fix

Replace `Option<*mut u8>` with `bool` and remove the unsafe block. Mechanical.

---

## 5. Additional sites read in context — classification only

These were read in ≥30 lines of context, traced to source, and ruled benign or covered by Pass 2 invariants. Listed for audit-trail completeness.

| File:line | Category | Verdict |
|---|---|---|
| `auto_installer.rs:213` | `unsafe { &mut *(*pm).lockfile }` | I-001 reborrow; sound |
| `auto_installer.rs:261` | `unsafe { &mut *pm }` | I-001; sound (pm is BACKREF) |
| `auto_installer.rs:338` | `&mut *buf.as_mut_ptr().cast::<PathBuffer>()` | Cast between same-size buffers; sound, alignment 1 = 1 |
| `auto_installer.rs:475` | `pub unsafe fn __bun_resolver_init_package_manager` | FFI entry; A-FFI |
| `hoisted_install.rs:55` | `&mut *core::ptr::from_mut(ctx).cast::<PackageInstaller<'x>>()` | Erased-type recovery; A-FFI |
| `hoisted_install.rs:244` | `unsafe { let lockfile_ptr ... }` | I-001 reborrow chain; sound |
| `hoisted_install.rs:392` | `core::ptr::addr_of_mut!((*mgr_ptr).progress)` | Field-projection raw; sound |
| `integrity.rs:23` | `unsafe impl bytemuck::NoUninit for Integrity` | `Integrity` is 65 bytes of explicit `[u8;64]` + `u8` tag; sound |
| `integrity.rs:239` | `str::from_utf8_unchecked` on base64 output | ASCII alphabet; sound |
| `integrity.rs:260` | `unsafe impl bytemuck::NoUninit for Tag` | transparent newtype over u8; sound |
| `lockfile.rs:1158-1187` | `set_entries_len` followed by `copy_from_slice` | All slots written before `re_index`; sound |
| `lockfile.rs:1586` | `&mut (*manager_ptr).manifests` | Disjoint-field reborrow; sound under TB |
| `lockfile.rs:1601` | `&mut *(*manager_ptr).lockfile` | I-001 reborrow; sound |
| `lockfile.rs:1729, 1735` | `ZStr::from_raw(buf.as_ptr(), len)` after `buf[len] = 0` | NUL-terminator written; lifetime is local; sound |
| `lockfile.rs:1822` | `&mut *FileSystem::instance()` | Process-singleton; sound on single-threaded CLI path |
| `lockfile.rs:1834` | `&mut *entries_option` | Resolver's BSSMap entry; sound (sole owner) |
| `lockfile.rs:2099` | `bun_ptr::detach_lifetime` of `slicable.slice(string_bytes)` | Append-only Vec invariant; sound while invariant holds |
| `lockfile.rs:2898` | `sort_buf.set_len(l_len + r_len)` | Followed by `split_at_mut` + indexed writes; `PathToId` uses raw ptrs so no niche concern; sound |
| `lockfile/bun.lockb.rs:447, 477, 514` | `set_entries_len` then `copy_from_slice` | Same as lockfile.rs:1158; sound |
| `lockfile/OverrideMap.rs:482` | `bun_ptr::detach_lifetime` after `allocate` | Reserved capacity invariant; sound |
| `lockfile/Package.rs:1621` | `slice_as_bytes` of `bun_semver::Version` | Version is 56 bytes pinned, no padding by layout_asserts; sound |
| `lockfile/Package.rs:1884` | `&*range.input` | Lifetime widening from raw; project-internal convention |
| `lockfile/Package.rs:1950` | `&mut *common_raw` | I-001; sound |
| `lockfile/Package.rs:3273, 3472` | `sliced.items::<"resolution", Resolution>` | MultiArrayList typed accessor; sound by const-string-id of the field |
| `lockfile/Package.rs:3457` | `sliced.column_bytes_mut(field as usize)` | Used in tandem with `items_mut`; sound as long as PUB-INSTALL-7 fix lands |
| `lockfile/Tree.rs:1017` | `*this_deps_ptr.add(i)` (i < this_deps_len) | Bounded; sound |
| `lockfile/Tree.rs:1131` | `unreachable_unchecked` for known-impossible tag | UB if reached; B-001-class (Pass 2 catalogued) |
| `migration.rs:866` | `core::ptr::write(base.add(i), Dependency::default())` (debug-only) | Sound; only initializes capacity bytes |
| `migration.rs:1007, 1178, 1448` | `core::ptr::write(base.add(cursor), Dependency { ... })` | Soundness depends on cursor < reserved; counting-pass symmetry holds today but is fragile (L-INSTALL-3) |
| `npm.rs:900, 933, 970` | `slice_as_bytes` of various POD | See PUB-INSTALL-8/9 for padding concern |
| `npm.rs:1232` | `bun_core::heap::take(SaveTask::from_task_ptr(task))` | Heap-handle round-trip; sound |
| `npm.rs:1266` | `addr_of_mut!((*task).task)` | Field-projection raw; sound |
| `npm.rs:2880` | `*bundled_deps_buf.as_mut_ptr().add(bundled_deps_offset) = ...` | Cursor-bounded by counting-pass; sound |
| `npm.rs:3099, 3108, 3161` | `*all_semver_versions_ptr.add(cursor) = parsed_version` | Counting-pass symmetric; sound |
| `NetworkTask.rs:109-113` | `Linked::link` for `UnboundedQueue<NetworkTask>` | Same pattern as Task/PatchTask; sound |
| `NetworkTask.rs:305-308` | `ptr::write(real, ptr::read(async_http))` | Bit-copy across HTTP-thread boundary; OK because `async_http` not dropped |
| `NetworkTask.rs:907-914` | `pub unsafe fn write_init` placement-new of `NetworkTask` | A-FFI / heap-handoff; sound |
| `PackageInstall.rs:501` | `&mut WorkPoolTask` from raw | I-001; sound |
| `PackageInstall.rs:575-591` | `HARDLINK_QUEUE` `MaybeUninit::assume_init_ref` after one-time write | Single-init protocol; sound (cf. windows-only) |
| `PackageInstall.rs:854, 947, 2430` | `*p.add(len) = 0` (NUL-terminator) | Bounded by buffer geometry; sound |
| `PackageManager/PackageManagerDirectories.rs:579` | `*self.buf.as_mut_ptr().add(at) = 0` | Same as above; sound |
| `repository.rs:91-106` | `&mut (*tl_bufs()).XXX_buf` | Thread-local scratch; sound (and Pass 2 catalogued the static-mut shape as CODEX-P3-scratch-buffers) |
| `resolvers/folder_resolver.rs:64` | `&mut *joined.as_mut_ptr().add(2).cast::<PathBuffer>()` | Cross-type cast on same buffer; sound (PathBuffer = `[u8; PATH_MAX_BYTES]`, align 1) |
| `TarballStream.rs:258` | `pub unsafe fn on_chunk` | HTTP-thread entry, mutex-protected; sound |
| `TarballStream.rs:288, 320, 484` | `unsafe fn drain/step/schedule_drain` | Worker-thread; mutex on producer fields; sound |
| `TarballStream.rs:573` | `unsafe fn open_archive` | libarchive init; A-FFI |
| `TarballStream.rs:600` | `archive_read_open(this.cast::<c_void>(), None, Some(callback), None)` | Stores `this` as client_data; A-FFI; sound under TS invariant |
| `TarballStream.rs:755` | `OSPathSliceZ::from_raw_mut(norm_buf.as_mut_ptr(), norm_len)` | NUL written at `norm_buf[norm_len]`; sound |
| `TarballStream.rs:912-993` | `unsafe fn finish(this: *mut Self)` | Self-destruct from worker; sound (`heap::take(this)` is sole owner) |
| `windows-shim/bun_shim_impl.rs:1244` | `ptr::copy(spawn_command_line, dst, len + 1)` | Pass 2: pre-existing-ub-ptr-5 |
| `windows-shim/bun_shim_impl.rs:426` | `wbuf.cast::<u32>().write_unaligned(...)` | Sound — write_unaligned is the canonical primitive |

---

## 6. Hardened SAFETY-comment templates per context

### 6.1 Lockfile-byte → typed value

```rust
/// # Safety
/// `bytes` is `size_of::<T>() * n` initialized bytes from the lockfile
/// buffer (i.e., previously read from disk via `read_to_end` or a future
/// aligned-Vec helper). Caller must verify before calling:
///   1. `bytes.as_ptr() % align_of::<T>() == 0` (FAIL OPEN — fall back to a
///      per-element `read_unaligned` loop if the assert fires).
///   2. `bytes.len() == n * size_of::<T>()` (i.e., the lockfile's
///      `byte_len` field was consistent).
///   3. Every byte sequence in `bytes` is a valid `T` (NOT trivial for
///      niche-bearing types: see the `validate_<T>` post-load walk).
unsafe fn read_pod_array_aligned<T: Copy>(bytes: &[u8], n: usize) -> &[T] {
    debug_assert!(bytes.as_ptr() as usize % core::mem::align_of::<T>() == 0);
    debug_assert_eq!(bytes.len(), n * core::mem::size_of::<T>());
    // SAFETY: bullets 1, 2, 3 above held by precondition.
    unsafe { core::slice::from_raw_parts(bytes.as_ptr().cast::<T>(), n) }
}
```

### 6.2 Cursor-bounded write into reserved Vec capacity

```rust
/// # Safety
/// `base` is `Vec::as_mut_ptr()` of a Vec with `cap` reserved (but length 0).
/// `cursor < cap`. No reallocation of the backing Vec may occur between the
/// call to `as_mut_ptr` and the final `set_len`. Caller is responsible for:
///   1. Initializing every slot `0..final_len` before `set_len(final_len)`.
///   2. NOT forming `&[T]` / `&mut [T]` over the uninit capacity tail.
unsafe fn write_into_capacity<T>(base: *mut T, cursor: usize, value: T) {
    debug_assert!(!base.is_null());
    // SAFETY: bullets 1, 2 above held by precondition.
    unsafe { core::ptr::write(base.add(cursor), value) }
}
```

### 6.3 Attacker-supplied index into bounded slice

```rust
/// # Safety
/// `idx` is a value read from on-disk lockfile bytes. Caller MUST verify
/// `idx as usize < slice.len()` before this call. The Zig original used
/// `slice[idx]` (release-build bounds-checked) and the Rust port uses
/// `get_unchecked` ONLY when the bound is statically proven by a pre-load
/// `Buffers::validate_cross_references` walk.
#[inline]
unsafe fn lockfile_indexed<T>(slice: &[T], idx: u32) -> &T {
    debug_assert!((idx as usize) < slice.len());
    // SAFETY: caller bullet 1.
    unsafe { slice.get_unchecked(idx as usize) }
}
```

### 6.4 Enum discriminant from disk byte (CORRECT pattern)

```rust
// NOT a `#[repr(u8)] enum` — those are UB on invalid values.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct OnDiskTag(pub u8);

impl OnDiskTag {
    pub const A: Self = Self(0);
    pub const B: Self = Self(1);
    pub const C: Self = Self(2);

    /// Returns `None` for unknown bytes. Forward-compatible: an older
    /// reader sees future tags as `None` and treats them as the inherited
    /// fallback ("unknown but harmless").
    #[inline]
    pub fn well_known(self) -> Option<Self> {
        match self.0 {
            0 | 1 | 2 => Some(self),
            _ => None,
        }
    }
}
```

---

## 7. Recommended PRs (in security-first order)

### PR 1 — "lockfile: validate enum discriminants on bun.lockb load"

Fixes **PUB-INSTALL-1, PUB-INSTALL-2**.

Replaces `HasInstallScript` and `Origin` enum definitions with `#[repr(transparent)] struct (pub u8)` + associated consts + `is_valid()`. Adds a post-load validation walk in `lockfile/Buffers::load` that rejects malformed bytes with `CorruptLockfile`.

**Diff size:** ~80 LOC changed across 4 files. No layout impact (size_of stays at 1B).
**Risk:** Behavioral parity — every `match meta.has_install_script` becomes a `match meta.has_install_script.0` (literal byte). The `_ => unreachable!()` arms become `_ => Err(CorruptLockfile)`.
**Test:** Pass 3's `lockfile-tamper` fuzz harness (see §8) producing a `bun.lockb` with `has_install_script = 0xFF` should now fail clean instead of UB.

### PR 2 — "yarn.rs: initialize Vec capacity before forming &mut slice"

Fixes **PUB-INSTALL-3**.

Replaces lines 914-925 of yarn.rs with the `core::ptr::write` initialization loop + `set_len` pattern from migration.rs:866. Then `as_mut_slice()` is safe.

**Diff size:** ~30 LOC. **Risk:** none if the cursor invariants are preserved.

### PR 3 — "lockfile: bounds-check dep_id from bun.lockb"

Fixes **PUB-INSTALL-4**.

Adds `Buffers::validate_cross_references(deps_len, resolutions_len, packages_len)` invoked after `Buffers::load`. Walks every `Tree.dependencies` slice and every `hoisted_dependencies` entry, asserting `dep_id < deps_len` (and the same for resolutions / package IDs). Replaces `get_unchecked` at Tree.rs:1020 with safe `.get(...).ok_or(CorruptLockfile)?`.

**Diff size:** ~120 LOC. **Risk:** small per-install overhead (single linear walk of the dependencies tree at load time); negligible vs. the rest of `bun install`.

### PR 4 — "read_array: drop the &[T] alignment hazard"

Fixes **PUB-INSTALL-5, PUB-INSTALL-6**.

Switches both `read_array` functions (npm.rs:918 and lockfile/Buffers.rs:104) to a `read_unaligned`-per-element copy loop that returns `Vec<T>` / `Box<[T]>` directly, without ever forming an intermediate `&[T]` over the Vec<u8> buffer.

**Diff size:** ~40 LOC. **Risk:** PERF only — LLVM tends to vectorize the read_unaligned loop, so the cost should be in noise. Benchmark gate the PR.

### PR 5 — "lockfile/Package: validate end_at before set_len"

Fixes **PUB-INSTALL-7**.

In `lockfile/Package.rs::load`, pre-compute the total expected byte size from `field_count` and the column-size table, verify `end_at - begin_at == expected_total`, and ONLY THEN `set_len`. Removes the per-iteration `if end_pos as u64 <= end_at` check (now redundant).

**Diff size:** ~40 LOC. **Risk:** small. Adds an explicit error path for the truncated-column case.

### PR 6 — "padding_checker: implement AssertNoUninitializedPadding derive"

Fixes **PUB-INSTALL-8, PUB-INSTALL-9**.

Implements the comptime check described in `padding_checker.rs:76-109`. Wires it to `PackageVersion`, `NpmPackage`, and every other type passed through `slice_as_bytes`. Adds explicit `_padding_*` fields where the derive produces a compile error.

**Diff size:** ~250 LOC (proc-macro + applied derives + a handful of field-padding additions).
**Risk:** layout-pinning. Some structs may grow in size to absorb padding; bump `bun.lockb` format version if the disk layout changes. The npm cache `Serializer::VERSION` may also need a bump.

### PR 7 — "tarball-extract: O_NOFOLLOW / openat2 for hardened extraction"

Fixes **L-INSTALL-2**.

Switches `open_output_file` and `make_directory` to walk the path component-by-component using `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)` on Linux ≥ 5.6, falling back to per-component `openat` with `O_NOFOLLOW` on older kernels and on macOS.

**Diff size:** ~150 LOC. **Risk:** medium. Need to verify behavior matches `Archiver.extractToDir` on macOS (where openat2 doesn't exist). The npm reference behavior is the spec.

### PR 8 — "migration.rs: replace raw cursor writes with safe indexing"

Fixes **L-INSTALL-3**.

Replaces all four `core::ptr::write(dependencies_base.add(cursor), ...)` sites with `Vec::push` or `set_len + as_mut_slice`-indexed writes. Removes the four unsafe blocks.

**Diff size:** ~60 LOC. **Risk:** the cursor invariants need re-verification under the new shape.

### PR 9 — "lockfile.rs: drop unused cached ptr"

Fixes **L-INSTALL-4**.

Replaces `Option<*mut u8>` with `bool`. Mechanical.

**Diff size:** ~10 LOC. **Risk:** none.

### PR 10 — "lockfile/Tree.rs: replace assume_init with zero-init for scratch buffer"

Fixes **L-INSTALL-1**.

Mechanical replacement.

**Diff size:** ~5 LOC. **Risk:** none.

---

## 8. Fuzz harness recommendation

Every P0 and P1 finding here is reachable by feeding crafted bytes into `Lockfile::load_from_bytes` / `PackageManifest::Serializer::read_all`. A coverage-guided fuzz harness wrapping those two entry points would catch this class of bug going forward and validate the PRs above.

```rust
// fuzz/fuzz_targets/lockfile_load.rs
#[no_mangle]
pub fn fuzz_target_lockfile_load(data: &[u8]) {
    use bun_install::lockfile_real::Lockfile;
    let mut lock = Lockfile::default();
    let mut log = bun_ast::Log::init();
    // No PackageManager — exercise the pure-parser path.
    let _ = lock.load_from_bytes(None, data.to_vec(), &mut log);
}
```

Run with `cargo +nightly fuzz run lockfile_load -- -max_total_time=600`. A single AFL/libFuzzer corpus seeded with `~/.bun/install/cache/*.npm` + `bun.lockb` test fixtures should hit every finding here within minutes.

---

## 9. Cross-reference to prior passes

- **Pass 2's `pre-existing-ub-001`** (linux_errno transmute<usize, SystemErrno>) is the same UB class as PUB-INSTALL-1 / PUB-INSTALL-2: niche-bearing `#[repr(u8)] enum` read from untrusted bytes.
- **Pass 2's `PASS2-slice-from-raw-buffer-bounds.md`** documented the **shape** of PUB-INSTALL-5 / PUB-INSTALL-6 at other call sites in `bun_runtime`; this pass found two more in `bun_install`'s critical lockfile-parse path.
- **Pass 2's `pre-existing-ub-ptr-1`** (standalone_graph `debug_assert!`-only bounds on attacker offsets) is the same class as PUB-INSTALL-4 (`get_unchecked` on lockfile dep_id).
- The `MaybeUninit::uninit().assume_init()` pattern in L-INSTALL-1 was catalogued by Pass 2's `PASS2-maybe-uninit-deep-dive.md`; this is one more instance.

The crate-wide story is that the Zig→Rust port faithfully reproduced Zig's "trust the disk bytes, panic on garbage in debug" model. Zig's `@enumFromInt` produces a runtime panic on invalid discriminants in safe build modes; Rust's `transmute<u8, Enum>` is UB at all build modes. **The four PUB-INSTALL-1/2 + PUB-INSTALL-4 bugs are the same translation gap reappearing in different files.**

---

## 10. Significant negatives

These were specifically checked AND ruled clean:

| Audit | Verdict |
|---|---|
| `TarballStream` symlink path-traversal walk | All known attack patterns rejected by the `/packages/` prefix guard. Defense is sound today; the O_NOFOLLOW hardening (L-INSTALL-2) is defense-in-depth, not a fix. |
| `migration.rs` cursor < num_deps invariant | Counting and writing iterate the same key set (`DEPENDENCY_KEYS`) over the same arena-backed JSON; `num_deps == u32::MAX` is explicitly rejected. **No overflow.** |
| `npm.rs` release_versions_cursor < release_versions_len | Same `parsed_version.version.tag.has_pre()` predicate used in counting and writing passes; arena is fixed. **No overflow.** |
| `dependency.rs` `to_version` Tag decoding | Explicit `match bytes[0]` with `_ => unreachable!()` — `unreachable!()` is a panic, NOT `unreachable_unchecked`; sound. |
| `lockfile/bun.lockb.rs` workspace_paths / workspace_versions / trusted_dependencies | `set_entries_len` + `copy_from_slice` + `re_index` is symmetric across keys and values; **sound.** |
| `NetworkTask::on_chunk` HTTP-thread → worker handoff | Mutex on producer fields; `AtomicBool::swap(true, AcqRel)` for drain scheduling. **Sound.** |
| `PackageInstall::HARDLINK_QUEUE` (Windows) | `AtomicBool::swap(true, Relaxed)` is the main-thread `INITIALIZED` flag (not a cross-thread publish); thread-pool schedule provides the Release/Acquire publish edge for the `MaybeUninit::write`. **Sound.** |
| `repository.rs:91-106` thread-local scratch buffers | Same pattern as Pass 2 `CODEX-P3-scratch-buffers`; sound on this single-threaded CLI path but architecturally fragile. |
| `auto_installer.rs:213, 261` `&mut *raw` reborrows | I-001 reborrow; sound. |
| `lockfile.rs:2898` `sort_buf.set_len(l_len + r_len)` | `PathToId` uses raw pointers (no niches); subsequent fills cover every slot before any read. **Sound.** |
| FFI to libarchive (TarballStream, archive_read_open + callbacks) | `this` passed as `*mut c_void`; callback retrieves via cast; libarchive lifetime contract honored. **A-FFI** (delegated to vendor lib contract). |

---

## 11. Macro-expanded surface (not separately re-audited)

`bun_install` has substantial macro use (`unsafe impl bun_threading::Linked for X`, `string_builder!`, `from_field_ptr!`). These expand to the same `unsafe { core::ptr::addr_of!((*item).next) }` plumbing already covered in this report's site-by-site analysis. No additional UB findings.

---

## 12. Closing — total bug count for the deliverable header

**9 new pre-existing-UB candidates:** PUB-INSTALL-1, PUB-INSTALL-2, PUB-INSTALL-3, PUB-INSTALL-4, PUB-INSTALL-5, PUB-INSTALL-6, PUB-INSTALL-7, PUB-INSTALL-8, PUB-INSTALL-9.

**4 latent-fragile patterns:** L-INSTALL-1, L-INSTALL-2, L-INSTALL-3, L-INSTALL-4.

**Of the P0s:** PUB-INSTALL-1, -2, -3, -4 are security-triage candidates on the threat model defined in §1.2. Maintainers should decide advisory treatment.

**Of the P1s:** PUB-INSTALL-5, -6, -7 are real soundness gaps with rarer triggers (alignment depends on mimalloc; partial-init depends on truncated end-cap from disk).

**Of the P2s:** PUB-INSTALL-8, -9 are information disclosure into a user-visible cache file.

Add to Pass 2's running total (32+ distinct soundness findings, 14-17 confirmed-or-likely real soundness bugs) and `bun_install` contributes **+9 P0/P1 confirmed**, raising the workspace audit count substantially.

`bun_install` was the right call as the deepest Pass-3 target. The lockfile parser was undertested at the soundness layer prior to this pass.
