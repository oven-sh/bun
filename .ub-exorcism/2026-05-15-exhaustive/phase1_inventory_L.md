# Section L Inventory — `install-and-pkg-manager`

Run: `2026-05-15-exhaustive`.  Source paths: `src/install/`, `src/install_jsc/`,
`src/install_types/`.  Tool ritual exit codes: 0/0/0.

**Site totals**

| Crate          | grep-counted unsafe sites | files with unsafe |
|----------------|---------------------------|-------------------|
| `bun_install`  | 576                       | 46                |
| `bun_install_jsc` | 2                       | 1                 |
| `bun_install_types` | 5                     | 2                 |
| **Section L**  | **583**                   | **49**            |

Delta vs Phase-0 prior (~531):  **+52**.  Walking the diff against
`/data/projects/bun/.unsafe-audit/unsafe-inventory.jsonl` (`jq` filter:
531 rows for `src/install*`), the gap is mostly newly added sites in
`src/install/PackageManager/*.rs`, `src/install/isolated_install/*.rs`, and
`src/install/lockfile/bun.lockb.rs` since the prior audit ran.  Macro-generated
sites in this section are nearly nil — `padding_checker.rs` emits trait impls
with `unsafe impl` blocks but no real `unsafe { … }` execution; the rest are
all source-direct.

The table below is row-per-file with a fan-out for the highest-risk
**lockfile-deserialiser** + **anchored-witness** sites.  Line numbers come from
the in-tree source as of this run; per-file totals echo
`/tmp/L_install_unsafe.txt` (76-line grep), and SAFETY-status totals are the
ratio of `// SAFETY:` lines (`/tmp/L_safety_comments.txt`, 575) to unsafe
keywords (576) — essentially 1:1 by intent, but the per-file audit shows ~6
files where the comment count under-runs the unsafe-keyword count by ≥2 lines
(noted in `notes` column).

| file:line | site_kind | bucket(s) | safety_status | macro_status | prior_id | notes |
|-----------|-----------|-----------|---------------|--------------|----------|-------|
| **— Anchored witnesses (EXP-003/005/006/007) —** | | | | | | |
| src/install/lockfile/Package/Meta.rs:39-46 | `#[repr(u8)] enum HasInstallScript` (Old=0, False=1, True=2) | 4 validity, 1 aliasing-via-byte-copy | PRESENT_STRONG (PORTING.md note inline) | SOURCE_DIRECT | n/a (type def) | **EXP-003 anchor**: discriminants 3..=255 invalid; read path is `Package::load_fields` → `bytes.copy_from_slice(...)` (Package.rs:3466) into a `[Meta]` column with no per-byte validity check |
| src/install/lockfile/Package.rs:3466-3478 | `bytes.copy_from_slice(stream.buffer)` into `column_bytes_mut::<Meta>()` + immediate `items_mut::<"meta", Meta>()` iter | 4 validity, 1 aliasing | PRESENT_WEAK ("memcpy from the serialised lockfile stream") | SOURCE_DIRECT | S-00269x (close) | **PUB-INSTALL-1/2** read path; iter at 3473-3478 forms `&mut [Meta]` over disk bytes and invokes `meta.needs_update()` which compares `HasInstallScript` discriminant — instant UB on bad byte |
| src/install/lib.rs:1128-1135 | `#[repr(u8)] enum Origin` (Local=0, Npm=1, Tarball=2) | 4 validity | MISSING (no SAFETY on the type) | SOURCE_DIRECT | n/a (type def) | **EXP-006 anchor**: same shape as HasInstallScript; flows into `Meta::origin` field copied via the same Package::load_fields memcpy |
| src/install/yarn.rs:918-925 | `bun_core::ffi::slice_mut(dependencies_base_ptr, num_deps)` before the backing `Vec<Dependency>` length is set | 5 uninit, 1 aliasing | PRESENT_WEAK ("capacity >= num_deps reserved above") | SOURCE_DIRECT | S-002...yarn.rs:918 | **EXP-005 anchor**: shape unchanged from prior; constructs `&mut [Dependency]` over allocated-but-uninitialized capacity. `slice_mut`/`from_raw_parts_mut` requires initialized `Dependency` elements, and `Dependency` contains a closed `#[repr(u8)]` tag (`DependencyVersionTag`, valid 0..=9). |
| src/install/lockfile/Tree.rs:1014-1020 | `*this_deps_ptr.add(i)` then `deps.get_unchecked(dep_id as usize)` | 1 aliasing, 4 validity (DepId), 15 OOB-escape | PRESENT_STRONG ("dep_id was produced by the same lockfile that produced deps; Zig release builds have no bounds check here") | SOURCE_DIRECT | S-00295x (close) | **EXP-007 anchor**: still present; SAFETY comment is *contractual* but the contract is "trust attacker bytes"; PUB-INSTALL-4 still applies |
| **— New / amplified lockfile-parser sites discovered this pass —** | | | | | | |
| src/install/lockfile/Buffers.rs:104-178 | `pub fn read_array<T: Copy>(stream: &mut Stream) -> Vec<T>` → `unsafe { bun_core::ffi::slice(stream.buffer.as_ptr().add(start_pos).cast::<T>(), …) }`.to_vec() | 4 validity (for validity-bearing `T`), 3 alignment, 5 uninit/padding, 6 type-pun | PRESENT_STRONG (170: "writer aligned the payload to align_of::<T>()") | SOURCE_DIRECT | n/a | **NEW EXP candidate:** generic typed-array reader validates bounds/alignment/size but not type validity. Do **not** overgeneralize: `dependency::External` is `[u8; N]` and is decoded by checked byte matches; `semver::Version`/`SemverString` are all-bit-valid but can later drive OOB string slicing. The strongest current validity-bearing reader is `Vec<PatchedDep>` because `PatchedDep` contains a Rust `bool` read from disk bytes. |
| src/install/lockfile/Package.rs:3432 | `unsafe { list.set_len(list_len as usize) }` then `load_fields` overwrites every column via copy_from_slice | 5 uninit (window between set_len and load_fields), 4 validity | PRESENT_WEAK ("capacity reserved above; load_fields writes every column") | SOURCE_DIRECT | S-00269x | If `load_fields` returns Err before completing all 8 columns, the leftover columns contain whatever bytes were already in the page — but `Drop` on List<Package> would read them as `&[Package]`. Currently unreached because the per-field range check at Package.rs:3464 returns before the partial write — confirm in Phase 2. |
| src/install/lockfile/Package.rs:3370 | `unsafe { list_for_migrating_from_v2.set_len(list_len as usize) }` (the v2→v3 migration arm) | 5 uninit / partial-load window | PRESENT_WEAK (same as above) | SOURCE_DIRECT | n/a | Migration arm uses `install::resolution::Tag`, a transparent `u8` newtype with an `_` match arm, not `resolver_hooks::ResolutionTag`; unknown tag bytes are not invalid-enum UB here. Keep this as a partial-initialization/control-flow audit item. |
| src/install_types/resolver_hooks.rs:303-324 | `#[repr(u8)] enum DependencyVersionTag` (Uninitialized=0, Npm=1, …, Catalog=9) | 4 validity | MISSING | SOURCE_DIRECT | n/a | Discriminants 10..=255 invalid. Reached by EXP-005's uninitialized `&mut [Dependency]` path. `read_array::<dependency::External>` itself reads `[u8; N]` and decodes `bytes[0]` with an explicit match/panic, so it is not an enum-validity UB at slice construction. |
| src/install_types/resolver_hooks.rs:1152-1167 | `#[repr(u8)] enum ResolutionTag` ({0,1,2,4,8,16,32,64,72,80,100}) | 4 validity | MISSING | SOURCE_DIRECT | n/a | Bridge-internal closed enum. Current `Package::resolution` lockfile column uses `install::resolution::Tag`, a transparent `u8` newtype, and `auto_installer.rs` converts to this closed enum by explicit match. Direct disk reachability is unproven and should not be counted as a lockfile enum-from-disk UB. |
| src/install_types/resolver_hooks.rs:1228-1235 | `#[repr(u8)] enum PreinstallState` | 4 validity | PRESENT_WEAK ("Zig: enum(u4); u8 is the smallest repr Rust allows") | SOURCE_DIRECT | n/a | Stored per-package in the in-memory state machine; sourced from manifest parser not on-disk lockfile bytes — lower-priority. |
| src/install/lockfile/Package.rs:978-985 | `#[repr(u8)] enum DiffOp` | 4 validity | MISSING | SOURCE_DIRECT | n/a | Only constructed via match arms in this crate; no disk path. Low priority. |
| src/install/PackageInstall.rs:69-77 | `#[repr(u8)] enum Method` | 4 validity | PRESENT_WEAK (PackageInstall.rs:107 round-trip note) | SOURCE_DIRECT | n/a | Stored as AtomicU8; round-trip through `from_u8` is *checked*, so this is sound. |
| src/install/PackageInstall.rs:219-247 | `#[repr(u8)] enum Step` (atomic state machine) | 4 validity | PRESENT_STRONG (`AtomicU8` note + `Step::from_u32` round-trip cited) | SOURCE_DIRECT | n/a | Round-trip via `Step::from_u8` is *checked*; sound. |
| src/install/isolated_install/Installer.rs:691-700 | `#[repr(u8)] enum Step` (mirror of PackageInstall.rs:219) | 4 validity | PRESENT_STRONG | SOURCE_DIRECT | n/a | Same checked-roundtrip pattern. Sound. |
| src/install/lockfile.rs:2780-2790 | `#[repr(u8)] pub enum Tag` (Lockfile-format tag inside `Stringifier`) | 4 validity | n/a | SOURCE_DIRECT | n/a | Constructed only by writer, never deserialised. |
| src/install/dependency.rs:59-66 | `#[repr(u8)]` for `dependency::Behavior` flags | 4 validity | PRESENT_STRONG (5 `const _: () = assert!` siblings at resolver_hooks.rs:293-298) | SOURCE_DIRECT | n/a | Bitflag-style: bytes are a bitset, not a closed enum; safe. |
| src/install/integrity.rs:252-260 | `#[repr(transparent)] struct Tag(u8)` (intentional: avoids enum-from-disk UB) | 4 validity, 10 FFI-contract | PRESENT_STRONG (comment explicitly rejects `#[repr(u8)] enum`) | SOURCE_DIRECT | n/a | **Defensive pattern** — explicitly cites avoiding the PUB-INSTALL bug class. `bytemuck::NoUninit` impl asserted via `unsafe impl`. |
| src/install/resolution.rs:879-890 | `#[repr(transparent)] struct Tag(u8)` for install-side `Resolution.Tag` | 4 validity | PRESENT_STRONG (same defensive comment) | SOURCE_DIRECT | n/a | Defensive and currently the package lockfile column's tag type (`Package.rs` imports `crate::resolution_real::Tag as ResolutionTag`). The closed `bun_install_types::resolver_hooks::ResolutionTag` is a bridge type, not the on-disk package-column tag. |
| src/install/auto_installer.rs:18-80 | bridge between install/resolver tags — explicit `match` translation (NOT transmute) | 4 validity, 6 type-pun (avoided) | PRESENT_STRONG (multi-paragraph) | SOURCE_DIRECT | n/a | Sound — explicitly rejects whole-struct transmute. |
| **— FFI / extern-C surface —** | | | | | | |
| src/install/TarballStream.rs:1171 | `extern "C" fn archive_read_callback` (libarchive callback) | 10 FFI, 21 callback-aliasing | PRESENT_STRONG (`ParentRef::from_raw_mut`) | SOURCE_DIRECT | n/a | Cross-checked against libarchive header; uses ParentRef wrapper. |
| src/install/windows-shim/main.rs:84,113 | `#[unsafe(naked)] pub extern "C" fn __chkstk` (x86_64 + aarch64) | 18 inline-asm, 10 FFI | PRESENT_STRONG | SOURCE_DIRECT | n/a | Verbatim port of compiler_builtins `__chkstk_ms` + aarch64 variant. Conditional on Phase-0 spawning bucket #18 sweeper for this file. |
| src/install/windows-shim/main.rs:134 | `pub extern "C" fn shim_main() -> !` (PE entry-point) | 10 FFI | PRESENT_STRONG (extensive doc) | SOURCE_DIRECT | n/a | Calls `_bun_shim_impl::main()`; sound. |
| src/install/windows-shim/main.rs:150 | `unsafe extern "system" { … }` (Win32 imports) | 10 FFI | PRESENT_WEAK | SOURCE_DIRECT | n/a | Cross-reference Win32 headers in Phase 2. |
| src/install/windows-shim/bun_shim_impl.rs:101,113,167,1264 | 4× `unsafe extern "system" { … }` blocks | 10 FFI | mostly PRESENT_WEAK | SOURCE_DIRECT | n/a | All Win32; bucket #10 sweeper. |
| src/install_types/NodeLinker.rs:89-127 | `unsafe extern "Rust" { __bun_regex_* }` + 3 unsafe call sites | 10 FFI (Rust-ABI cross-crate) | PRESENT_WEAK (74-89 explanation present) | SOURCE_DIRECT | n/a | The `extern "Rust"` block is a workaround for the Zig-derived link layout; `__bun_regex_*` symbols defined `#[no_mangle]` elsewhere. Audit symbol-pairing in Phase 2. |
| src/install_jsc/ini_jsc.rs:108,221 | 2× `unsafe { &mut *env }` / `&*(&raw const parser.arena)` | 1 aliasing | MISSING | SOURCE_DIRECT | n/a | JSC bridge; the arena one is a `&raw const` → `&` punt across a method call. Audit Phase 2. |
| **— Other unsafe primitives (aggregate, per file) —** | | | | | | |
| src/install/windows-shim/bun_shim_impl.rs:* | 78 unsafe sites — MaybeUninit + from_raw_parts + assume_init pattern on stack buffers | 5 uninit, 1 aliasing, 10 FFI | mix PRESENT_STRONG / PRESENT_WEAK | SOURCE_DIRECT | S-002… many | Windows shim launcher; no_std, panic=abort. Bucket #5 + #10 focus. |
| src/install/PackageManager.rs:* | 40 unsafe sites | 1 aliasing (ParentRef pattern), 5 uninit (`MaybeUninit::assume_init` after `write`), 10 FFI | mostly PRESENT_STRONG | SOURCE_DIRECT | S-00248x..S-00250x | `unsafe { ZStr::from_raw(buf.as_ptr(), len) }` is the dominant shape; relies on caller-provided len. ROOT_PACKAGE_JSON_PATH at 1837 is `MaybeUninit::write` once at startup — sound. |
| src/install/PackageManager/runTasks.rs:* | 38 unsafe sites incl. `assume_init_drop()` at 982, 1063 | 1 aliasing, 5 uninit, 13 refcount-lifecycle | mostly PRESENT_STRONG | SOURCE_DIRECT | n/a | The `assume_init_drop()` sites pair with `assume_init_ref` reads earlier on the same path — verify each pair is well-formed. |
| src/install/PackageManager/PackageManagerEnqueue.rs:* | 33 unsafe sites; 3× `ParentRef::from_raw_mut(std::ptr::from_mut::<…>)` at 362/1665/1809 | 1 aliasing (ParentRef pattern), 13 refcount-lifecycle | PRESENT_STRONG | SOURCE_DIRECT | n/a | ParentRef BACKREF pattern — see CLAUDE.md `borrow = ptr` mode. |
| src/install/TarballStream.rs:* | 31 unsafe sites incl. the libarchive callback at 1171 | 10 FFI, 1 aliasing, 21 callback-aliasing | PRESENT_STRONG (per-call doc) | SOURCE_DIRECT | n/a | libarchive callback boundary. |
| src/install/PackageInstall.rs:* | 28 unsafe sites incl. HARDLINK_QUEUE `assume_init_ref` at 553/577/591/621 | 1 aliasing (static MaybeUninit), 5 uninit, 7 data-race-adjacent | PRESENT_STRONG (multi-paragraph at 553-593) | SOURCE_DIRECT | n/a | Static `RacyCell<MaybeUninit<HardLinkQueue>>` w/ AtomicBool publication — Phase 2 should re-verify ordering. |
| src/install/lifecycle_script_runner.rs:* | 24 unsafe sites; `ZStr::from_raw_mut(buf.as_mut_ptr(), len-1)` at 576 | 10 FFI, 5 uninit | PRESENT_WEAK in spots | SOURCE_DIRECT | n/a | Subprocess spawn; the len-1 is suspicious — confirm trailing NUL handling in Phase 2. |
| src/install/PackageManagerTask.rs:* | 23 unsafe sites incl. 2× `core::hint::unreachable_unchecked()` at 284/542 | (none — these are AT-MOST hint UB if reached) | PRESENT_WEAK (no SAFETY on the unreachable_unchecked) | SOURCE_DIRECT | n/a | Each unreachable_unchecked is inside a match arm guarded by an outer `if` — if that outer check has a logic bug, instant UB. Phase 2 hand-verify both. |
| src/install/NetworkTask.rs:* | 22 unsafe sites; ParentRef + 2× `core::mem::forget(core::mem::take(&mut header_builder.content))` at 588/783 | 1 aliasing, 11 mem::forget | PRESENT_STRONG (581 cites lifetime guarantee) | SOURCE_DIRECT | n/a | Inhibits Drop intentionally; header_builder.content is then `into_raw`-pulled into the HTTP request body. |
| src/install/isolated_install/Installer.rs:* | 20 unsafe sites; `set_length` / `assume_init` on path buffers | 5 uninit, 1 aliasing | PRESENT_STRONG | SOURCE_DIRECT | n/a | Hardlinker path-buffer pool pattern; comments cite the save/restore invariant. |
| src/install/PackageManager/PackageManagerDirectories.rs:* | 18 unsafe sites | 1 aliasing, 5 uninit | PRESENT_STRONG | SOURCE_DIRECT | n/a | |
| src/install/PackageManager/security_scanner.rs:* | 16 unsafe sites + 1 `const _: () = assert!` | 1 aliasing, 5 uninit | PRESENT_STRONG | SOURCE_DIRECT | n/a | |
| src/install/PackageManager/PopulateManifestCache.rs:* | 15 unsafe sites | 1 aliasing, 5 uninit, 10 FFI | PRESENT_STRONG | SOURCE_DIRECT | n/a | |
| src/install/PackageManager/install_with_manager.rs:* | 14 unsafe sites | 1 aliasing, 5 uninit | PRESENT_STRONG | SOURCE_DIRECT | n/a | |
| src/install/padding_checker.rs:* | 13 unsafe sites — `unsafe impl AssertNoUninitializedPadding` per primitive | 5 uninit (declaration of intent — the trait is the no-padding witness) | n/a (trait impl) | SOURCE_DIRECT | n/a | Pure trait registration; no executable unsafe code. |
| src/install/lockfile/Package.rs:* | 13 unsafe sites (already broken out above for the load path) | mix | mostly PRESENT_WEAK on the disk-byte path | SOURCE_DIRECT | n/a | See anchor rows above. |
| src/install/lockfile.rs:* | 13 unsafe sites — incl. `set_len` at 2898, ZStr::from_raw at 1729/1735 | 5 uninit, 1 aliasing, 10 FFI | mostly PRESENT_STRONG | SOURCE_DIRECT | n/a | EqlSorter `set_len` then fill is sound (loop writes every slot); ZStr from path-buffer pool sound. |
| src/install/patch_install.rs:* | 12 unsafe sites; `unsafe impl bun_threading::Linked` at 68 | 8 Send/Sync, 1 aliasing | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/hoisted_install.rs:* | 12 unsafe sites incl. 4× `BackRef::from_raw(addr_of_mut!((*buffers).…))` at 249-254 | 1 aliasing (BackRef pattern), 13 refcount-lifecycle | PRESENT_STRONG | SOURCE_DIRECT | n/a | |
| src/install/npm.rs:* | 11 unsafe sites + 2× `const _: () = assert!` at 762/888 | mostly low-risk | mostly PRESENT_STRONG | SOURCE_DIRECT | n/a | Comments at 2545/3274/3345 explicitly *replaced* `from_raw_parts` with safe slice indexing — good. |
| src/install/PackageInstaller.rs:* | 10 unsafe sites; `ZStr::from_raw_mut` at 1197 | 10 FFI, 1 aliasing | PRESENT_STRONG | SOURCE_DIRECT | n/a | |
| src/install/bin.rs:* | 9 unsafe sites; `ZStr::from_raw(r.as_bytes().as_ptr(), r.len())` × 7 | 10 FFI, 15 escape | mostly PRESENT_WEAK | SOURCE_DIRECT | n/a | Bin symlink writer; ZStr ergonomics. |
| src/install/auto_installer.rs:* | 9 unsafe sites — 8 of which form the resolver-bridge `&mut *(*pm).lockfile` discipline | 1 aliasing | PRESENT_STRONG | SOURCE_DIRECT | n/a | Raw `*mut PackageManager` reborrow pattern; well-documented. |
| src/install/lib.rs:* | 7 unsafe sites; `ZStr::from_raw(optional_bun_path…)` at 628, `(*ARENA.get()).assume_init_ref()` at 846, `this_transpiler.assume_init_mut()` at 879 | 5 uninit, 10 FFI | PRESENT_WEAK | SOURCE_DIRECT | n/a | ARENA pattern documented at 857. |
| src/install/windows-shim/main.rs:* | 6 unsafe sites; `unsafe impl<T: ?Sized> Sync for RacyCell<T>` at 214 | 8 Send/Sync, 1 aliasing | PRESENT_STRONG (206-213 explains transparent over UnsafeCell) | SOURCE_DIRECT | n/a | |
| src/install/repository.rs:* | 6 unsafe sites | 1 aliasing, 14 const-mut | PRESENT_STRONG | SOURCE_DIRECT | n/a | UnsafeCell-wrapped PathBuffer per 25 comment. |
| src/install/isolated_install.rs:* | 6 unsafe sites; `uninit.assume_init()` at 2049 | 5 uninit | PRESENT_STRONG (2026 explicitly warns about uninit) | SOURCE_DIRECT | n/a | |
| src/install/migration.rs:* | 5 unsafe sites; 2× `set_len(res_cursor)` at 1492/1493 | 5 uninit | PRESENT_WEAK | SOURCE_DIRECT | n/a | Mirrors yarn.rs:1401-1402 set_len pattern after dependency fill. |
| src/install/yarn.rs:* | 3 unsafe sites total (slice_mut at 918-925 already broken out; set_len at 1401-1402) | 5 uninit, 1 aliasing | PRESENT_WEAK | SOURCE_DIRECT | S-002… | Anchor witness EXP-005. |
| src/install/resolvers/folder_resolver.rs:* | 4 unsafe sites | 1 aliasing | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/lockfile/Tree.rs:* | 4 unsafe sites (anchor row above + 91 `MaybeUninit::uninit().assume_init()` for DepthBuf + 1131 unreachable_unchecked) | 5 uninit, 4 validity, 1 aliasing | mostly PRESENT_WEAK | SOURCE_DIRECT | n/a | Tree.rs:91 `MaybeUninit::uninit().assume_init()` for a `[u8; N]` DepthBuf is sound (u8 has no validity); flagged for Phase 2 to confirm `N` is `[u8; _]`. |
| src/install/PackageManager/updatePackageJSONAndInstall.rs:* | 4 unsafe sites | mix | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/integrity.rs:* | 3 unsafe sites — 2× `unsafe impl bytemuck::NoUninit` at 23,260 + Tag newtype | 10 FFI, 6 type-pun | PRESENT_STRONG | SOURCE_DIRECT | n/a | Defensive — see anchor row. |
| src/install/PackageManager/PackageManagerLifecycle.rs:* | 3 unsafe sites | mix | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/PackageManager/PackageJSONEditor.rs:* | 3 unsafe sites | mix | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/lockfile/bun.lockb.rs:* | 3 unsafe sites | 5 uninit | PRESENT_WEAK | SOURCE_DIRECT | n/a | Mostly thin glue over Buffers::read_array. |
| src/install/lockfile/Buffers.rs:* | 2 unsafe sites — the read_array body + 1 sibling | (covered above) | PRESENT_STRONG on body, PRESENT_WEAK on alignment-postcondition | SOURCE_DIRECT | n/a | |
| src/install/lockfile/Package/WorkspaceMap.rs:* | 2 unsafe sites | 1 aliasing | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/extract_tarball.rs:* | 2 unsafe sites | 10 FFI | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/hosted_git_info.rs:* | 2 unsafe sites | 1 aliasing | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/isolated_install/FileCopier.rs:* | 2 unsafe sites | 5 uninit, 1 aliasing | PRESENT_STRONG (164/225 cite save/restore) | SOURCE_DIRECT | n/a | |
| src/install/resolution.rs:* | 2 unsafe sites | 4 validity (Tag transparent newtype) | PRESENT_STRONG | SOURCE_DIRECT | n/a | Defensive. |
| src/install/windows-shim/BinLinkingShim.rs:* | 2 unsafe sites | mix | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/lockfile/OverrideMap.rs:1 site | n/a | 1 aliasing | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install/isolated_install/Hardlinker.rs:1 site (+ several `set_length` save/restore) | 5 uninit | PRESENT_STRONG | SOURCE_DIRECT | n/a | |
| src/install/PackageManager/ProgressStrings.rs:1 site | n/a | low | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install_jsc/ini_jsc.rs:108,221 | (covered FFI row above) | 1 aliasing | MISSING | SOURCE_DIRECT | n/a | |
| src/install_types/NodeLinker.rs:89,107,114,125 | (covered FFI row above) | 10 FFI | PRESENT_WEAK | SOURCE_DIRECT | n/a | |
| src/install_types/resolver_hooks.rs:444 | `unsafe { core::ptr::read(self) }` for `DependencyVersionValue::clone` (union) | 5 uninit, 6 type-pun | PRESENT_STRONG (440-443 cites union variant invariant) | SOURCE_DIRECT | n/a | Union deep-copy by `ptr::read`; sound IFF active variant is `Copy`/POD as claimed. |

**Aggregate counts (Section L)**

| bucket(s) | rough share of unsafe sites |
|---|---|
| 1 aliasing | ~40% (ParentRef / BackRef / `*mut Self` callbacks) |
| 5 uninit | ~25% (MaybeUninit pools, `set_len`, `set_length` path-buf) |
| 10 FFI | ~15% (Win32, libarchive, JSC bridges, ZStr::from_raw) |
| 4 validity (lockfile bytes) | **~5% of sites, ~95% of section risk** |
| 8 Send/Sync | ~3% (`Linked` impls) |
| 13 refcount-lifecycle | ~3% (`heap::into_raw` / `take` / `destroy`) |
| 11 mem::forget | ~1% (header_builder takes) |
| 18 inline-asm | 2 sites (windows-shim __chkstk) |
| other | remainder |

Macro-generated: zero (`unsafe impl AssertNoUninitializedPadding for $T` in
`padding_checker.rs` is a declarative trait registration, not executable
unsafe).
