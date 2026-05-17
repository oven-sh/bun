# Bun UB Runbook — staying UB-free going forward (v2)

> Permanent maintainer-facing runbook output of run `2026-05-15-exhaustive`.
> Sibling to [`FINAL_UB_REPORT.md`](./FINAL_UB_REPORT.md) which carries the
> point-in-time audit findings; this file is the steady-state operational
> guide. v2 refresh adds: codegen + vendor bootstrap recipes, expanded "If you
> change X, re-run EXP-Y" table for the post-Tier-3 confirmations
> (EXP-006/007/008/009/020/026/027/033..044/045..050/051/053/057/059/072/073/074/075/076/080/081/082/083/084/085/086/087/088/089/090),
> the Phase 6 idea-wizard infrastructure recommendations (EXP-061..EXP-071),
> the strict-provenance migration path (EXP-048 centralised TaggedPtr + the
> separate representation rewrites for EXP-049/050/096), the
> HiveArray / HiveArrayFallback 8-caller migration (EXP-072), the **EXP-051
> compatibility-first checked-conversion remediation** per Phase 8 triangulation, and the
> `link_interface!` generated-handle field-privacy gate (EXP-080),
> POSIX `dir_iterator::Name` lifetime-erased result hardening (EXP-081),
> `Blob` JS-thread-affinity split (EXP-082), shell IO non-`Sync` hardening
> (EXP-083), the `VirtualMachine` safe TLS trap (EXP-084), and
> byte-safe `fmt::Raw` / `fmt::s` display hardening (EXP-085),
> `unsafe_assert` deletion / safe-panic conversion (EXP-086), plus
> `ThreadPool::get_worker` worker-handle hardening (EXP-087), and
> `E::String::init_utf16` / `slice16` UTF-16 representation hardening (EXP-088),
> primitive scratch-buffer initialization hardening (EXP-089), the H3
> header-vector `set_len` no-evidence regression guard (EXP-090),
> `BindgenArray` allocator-layout hardening (EXP-091), `ReadResult` owned-slice
> tokenization (EXP-092), PE header unaligned parsing (EXP-093), intrusive-list
> deletion/redesign (EXP-094), Mach-O load-command unaligned mutation
> hardening (EXP-095), errno safe-API checked conversion (EXP-097),
> `AtomicCell<T: Copy>` bounded auto-traits (EXP-098), node-cluster IPC /
> SSLWrapper callback receiver cleanup (EXP-099/100), and the ProxyTunnel
> `shutdown(&mut self)` / `write(&mut self, buf)` /
> `on_writable(&mut self, ...)` / `receive(&mut self, ...)` stale-wrapper
> cleanup (EXP-101/102/103), WindowsNamedPipe/PipeWriter receiver cleanup
> (EXP-104/106), and RareData/EventLoop callback-runner receiver cleanup
> (EXP-107/108/110), bundler part-range worker `&mut` / shared-renamer cleanup (EXP-111), and the EXP-109 source-root-graph correction.

## Toolchain prerequisites

Per `phase0_run.json:toolchain` and Phase 11 path-(b) experience:

- **rustc 1.97.0-nightly** or later, with `rust-src`
- **`cargo +nightly miri`** — install via `rustup component add miri --toolchain nightly`
- **`cargo-fuzz` 0.13.1+** — for the cluster-wide soak campaigns
- **`cargo-geiger` 0.13.0+** — for unsafe-surface trend tracking
- **`cargo audit`** + **`cargo deny`** — for RUSTSEC + supply-chain hygiene baseline
- **`clang-21`**, **`lld-21`**, **`ninja-build`** — required by `bun bd --configure-only` to materialise `build_options.rs` and run codegen ninja statements
- For dispatch: **`rch`** workers `worker-a` + `worker-b` (tagged `bun,go,rust`, 16 total slots)

On Ubuntu 24.04+:

```bash
sudo apt-get install -y clang-21 lld-21 ninja-build
rustup install nightly && rustup component add miri rust-src --toolchain nightly
cargo install cargo-fuzz cargo-geiger cargo-audit cargo-deny --locked
```

## How to actually run the audit (codegen + vendor bootstrap)

The "Miri the whole workspace" recipe needs three preconditions that are easy to
miss. They surfaced as **incidental findings I-2 / I-4 / I-5** during this run.

### 1. Bootstrap `vendor/lolhtml` (and other vendor-fetched deps)

`bun bd --configure-only` materialises `build_options.rs` but **does NOT fetch
vendored C deps**. `vendor/` stays empty, breaking every `cargo metadata` call
across the workspace:

```
unable to update /data/projects/bun/vendor/lolhtml/c-api
failed to read /data/projects/bun/vendor/lolhtml/c-api/Cargo.toml
```

Workaround (I-2):

```bash
cd /data/projects/bun/vendor
mkdir -p lolhtml && cd lolhtml
git clone --depth 1 https://github.com/cloudflare/lol-html.git .
git fetch --depth 1 origin 77127cd2b8545998756e8d64e36ee2313c4bb312
git checkout --detach 77127cd2b8545998756e8d64e36ee2313c4bb312
```

The same applies to every other `*_sys` crate with a vendored path-dep
(`boringssl_sys`, `cares_sys`, `libuv_sys`, …). Long-term fix: have
`bun bd --configure-only` run the source-fetch step for each dep in
`scripts/build/deps/*.ts`, or document the workaround in `CLAUDE.md`.

### 2. Run the codegen ninja step (I-5)

`bun bd --configure-only` generates `build.ninja` and a few stubs, but does
**not** run the ninja codegen rules. As a result:

- `build/debug/codegen/cpp.rs` is **1.7 KB** stub (not the ~MB real file)
- `build/debug/codegen/generated_classes.rs` is **44 bytes**
- `build/debug/codegen/generated_host_exports.rs` is **49 bytes**
- `build/debug/codegen/generated_js2native.rs` is **46 bytes**
- `build/debug/codegen/generated_jssink.rs` is **43 bytes**

Without the real codegen, `cargo check --workspace` fails at `bun_jsc` with 65
errors because `bun_jsc::cpp::*` resolves to the stubs. To unblock workspace
workflows:

```bash
cd /data/projects/bun
bun bd --configure-only
ninja -C build/debug \
  codegen/cpp.rs \
  codegen/generated_classes.rs \
  codegen/generated_host_exports.rs \
  codegen/generated_js2native.rs \
  codegen/generated_jssink.rs
```

After this + the vendor bootstrap, the full workspace check passes in ~32s:

```bash
cargo check --workspace 2>&1 | tee phase11_artifacts/cargo_check_workspace_v2.log
# Finished `dev` profile [unoptimized + debuginfo] target(s) in 32.21s
```

Long-term fix: add `bun bd --codegen-only` that runs `configure + vendor-fetch + codegen-ninja-statements` (but skips the C++/Rust compile step). This single
recipe unlocks every cargo-only workflow: `cargo check --workspace`,
`cargo +nightly miri test --workspace`, `cargo clippy --workspace`,
`cargo-geiger --workspace`.

### 3. Disambiguate `bun_collections::LinearFifo::init()` for tests (I-3)

The current per-buffer-type `init()` definitions in `src/collections/linear_fifo.rs:212/224/237` are ambiguous when called as `LinearFifo::<T, _>::init()`. Until a
disambiguation lands (rename to `new_static`/`new_dynamic`/`new_slice`, or
require explicit buffer-type at call sites), `cargo +nightly miri test --lib`
fails to compile for `bun_collections`. Path-b workaround: run Miri on
`bun_threading`, `bun_semver`, `bun_safety` (which **do** compile clean) and
defer `bun_collections` until the test compilation is unblocked.

### 4. Doc-comment `defer` in `bun_safety` (I-1)

`src/safety/CriticalSection.rs:1-28` has rustdoc-extracted doctests that
contain Zig's `defer` keyword. rustdoc tries to compile them as Rust and fails.
Wrap example lines in `` ```text `` / `` ```ignore `` / `` ```no_run `` to
unblock `cargo doc` and `cargo +nightly miri test --doc`.

## CI Gates To Wire

### Required high-yield coverage gates

These gates cover the dominant UB classes from the current registry. They are
not a substitute for the per-EXP regression tests in Phase 8 / Phase 9:
safe-API contract defects such as EXP-078/082/083/084/085/086/091/092 need
their own focused tests or compile-fail checks in addition to the broad suite.

#### Miri matrix

`cargo +nightly miri test` with `MIRIFLAGS` matrix per push to `main`:

1. **default Stacked Borrows** — catches EXP-001/002/003/005/006/014/017/019/021/026/027/033/034/035/036/039/045/047/057/058/059/073/074/075/076/080
2. **`-Zmiri-tree-borrows`** — strict aliasing model. Caught EXP-010/011/014/026/041/042/043/044/057/058/073/074/075/076/087/099/100/101/102/103/104/106
3. **`-Zmiri-strict-provenance`** — caught EXP-020 plus the Cluster-D provenance family (true TaggedPtr helper, EnvStr, `StringOrTinyString`, ZigString, `SmolStr`, custom packed-pointer rows, and reviewed FFI/layout-only numeric-pointer rows — EXP-029/048/049/050/096)
4. **`-Zmiri-symbolic-alignment-check`** — caught EXP-004 (`Vec<u8>→Vec<u16>` allocator-layout), EXP-088 (`E::String` UTF-16 narrowed-range retag), EXP-093 (`bun_exe_format::pe` typed references over unaligned byte offsets), and EXP-095 (`bun_exe_format::macho` typed mutable references over byte-backed load commands)

Per-EXP MIRIFLAGS recipes are in §"MIRIFLAGS combinations" below. EXP-005, EXP-039, and other `mem::forget`-bearing reproducers additionally need `-Zmiri-ignore-leaks`.

#### Release-mode Miri

EXP-008 and EXP-009 only fire in release mode (the `debug_assert!` is stripped and `get_unchecked` proceeds). Run at minimum:

```bash
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri test --release --package bun_semver
```

#### Sanitizers

- **ASan** via `-Zsanitizer=address` against the Bun test suite — catches buffer overruns the Miri matrix can't reach in pure-C-FFI paths (picohttp, uSockets, libuv)
- **TSan** via `-Zsanitizer=thread` against the Bun test suite — catches the race surface for EXP-030/031/032/038/047/060 and guards against any future EXP-017-style callback mutation after queue publication. Requires `--test-threads=1` to keep TSan's shadow memory tractable.
- **LSan** is implicit under ASan; treat any new leak as a regression.

#### Audit-PR landing tracker

Three accepted-but-unmerged fixes from prior audit's PR [#30765](https://github.com/oven-sh/bun/pull/30765) close EXP-002 / EXP-018 / EXP-019. Add a CI gate that:

- Flags any new commit touching `src/threading/guarded.rs`, `src/ast/nodes.rs`, or `src/errno/linux_errno.rs` without first landing the PR.
- Re-runs the EXP-002/018/019 reproducers as a regression suite once landed.

### Strongly recommended

#### `cargo-fuzz` campaigns

Prior unsafe-audit `fuzz-lockfile` + `fuzz-inverse` targets are at `.unsafe-audit/fuzz-*/`. Add new targets for the lockfile sparse-enum cluster:

```bash
cargo +nightly fuzz run lockfile_resolution_tag    # ResolutionTag enum
cargo +nightly fuzz run lockfile_dependency_version_tag  # DependencyVersionTag enum
cargo +nightly fuzz run lockfile_patched_dep_bool  # EXP-036 PatchedDep bool validity
cargo +nightly fuzz run standalone_module_graph_tampered  # EXP-035 4 sparse enums × 256^4
cargo +nightly fuzz run windows_file_notify_action  # EXP-037 regression: ensure raw DWORD decode stays checked
cargo +nightly fuzz run bun_loader_host_input  # EXP-051 BunLoader (u8 as u32) — public FFI
```

24-hour campaign budget per target on the rch worker-a/worker-b workers (tagged `bun,go,rust`).

#### Loom models

Tier-1 loom models for the 4 concurrency hubs are already authored under `experiments/EXP-030..032,052/` — extend each with 10⁴+ iterations and the "sanity_should_race" negative test to confirm the model captures the actual synchronisation. Re-run on every PR that touches:

- `src/threading/ThreadPool.rs` (EXP-030 — `Queue<T>` `Cell<*mut Node>` cache)
- `src/runtime/bake/DevServer/WatcherAtomics.rs` (EXP-031 — triple-buffered HotReloadEvent)
- `src/jsc/web_worker.rs` (EXP-032 — `Cell<*mut WebWorker>` / `Cell<*mut VirtualMachine>`)
- `src/threading/unbounded_queue.rs` (EXP-052 — lock-free MPSC `UnboundedQueue<T>`; loom 2P-1C now on file as regression guard)
- `src/threading/channel.rs` (F-DR-2 — `Channel<T, B>` MPMC; loom 2P-1C owed)

`shuttle` remains the right tool for the EXP-060 finalizer/env-teardown subcase, but the primary `napi::ThreadSafeFunction` bug is already Miri-confirmed: producer-thread exported wrappers mint `&mut ThreadSafeFunction` from the same raw C handle before taking the internal mutex.

#### `cargo-geiger` trend tracking

```bash
cargo geiger --output-format Json --all-targets > geiger.json
```

Track unsafe-site count per crate over time; alert if any crate climbs above its baseline more than 10% in a release. Baseline captured in `phase11_artifacts/tools/geiger_v2.txt`.

#### `cargo audit` + `cargo deny`

```bash
cargo audit
cargo deny check
```

Current run flags **RUSTSEC-2024-0436** (`paste 1.0.15` unmaintained), reachable via `bun_collections → bun_zlib → bun_standalone_graph → bun_runtime`. Replacement candidates: `pastey`, `paste2`, or hand-written `macro_rules!`. Not UB but supply-chain hygiene.

#### Layout-assert CI

The gold-standard discipline lives in `src/libuv_sys/libuv.rs` (74 `assert_size!` / `assert_offset!` cross-validated against runtime `uv_*_size()`). Every `#[repr(C)]` struct in `*_sys` crates should mirror this:

- `src/runtime/napi/napi_body.rs` — 5 N-API POD structs lack asserts today (EXP-054); **PoC delivered at `experiments/layout_asserts/napi.rs`** with analytical asserts for `napi_property_descriptor`, `napi_extended_error_info`, `napi_type_tag`, `napi_node_version`, `struct_napi_module`. EXP-054 is now `NO_EVIDENCE` for current LP64 layout drift after the C/Rust cross-check; this remains a CI hardening gate under EXP-063.
- `src/windows_sys/externs.rs` — 48 structs, 4 asserts (F-10-4)
- `src/boringssl_sys/boringssl.rs` — 15 structs, 0 asserts (F-10-5)

Phase 11 build-script: emit a C-side reflector that prints `sizeof(T)` / `offsetof(T, field)` per struct, write a `build_options.layout` file, and fail the build if any `assert_size!`/`assert_offset!` macro disagrees with upstream. EXP-063 (`#[layout_locked]` derive + C-reflector build-script) is the recommended infrastructure vehicle for this.

## MIRIFLAGS combinations to enforce

Per-crate Miri invocations:

```bash
# Default Stacked Borrows (catches niche / validity / aliasing)
cargo +nightly miri test --package <crate>

# Strict provenance (catches int-to-ptr round trips, masked-int reconstruction)
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri test --package <crate>

# Tree Borrows (stricter aliasing — caught EXP-041..044, EXP-057, EXP-058, EXP-073, EXP-074, EXP-075, EXP-076)
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri test --package <crate>

# Symbolic alignment (catches allocator-layout-mismatch — EXP-004)
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri test --package <crate>

# Release mode (catches release-only get_unchecked OOB — EXP-008/009)
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri test --release --package bun_semver

# For reproducers that intentionally leak (forget() / Box::leak)
MIRIFLAGS="-Zmiri-ignore-leaks -Zmiri-strict-provenance" cargo +nightly miri run --bin <bin>
```

**Note:** `-Zmiri-check-number-validity` is rejected as unknown on `1.97.0-nightly (f53b654a8 2026-04-30)`. Default Miri already validates niches / enums and reports invalid tags. Do not add the stale flag.

Combined matrix for full coverage (per `phase3_dynamic_findings.md` Path c, `phase11_soak_designs.md` §1 Campaign 1):

```bash
for cfg in "" "-Zmiri-tree-borrows" "-Zmiri-strict-provenance" "-Zmiri-symbolic-alignment-check"; do
  MIRIFLAGS="$cfg" cargo +nightly miri test --workspace
done
```

Multi-day runtime under the full Bun test suite — recommended offload to `rch worker-a/worker-b` workers tagged `bun,go,rust`. **Dispatch limitation discovered during Phase 11 probe**: `rch exec --` falls through to local for non-compile commands; use direct `ssh ubuntu@<worker> -t -- bash -lc '<command>'` with `nohup` + `disown` for 24h+ campaigns. See `phase11_soak_designs.md` §3.

## SAFETY-comment template

For every new `unsafe { … }` block, require this minimum template:

```rust
// SAFETY: <named precondition 1>; <named precondition 2>; <named precondition 3>.
// CALLER MUST UPHOLD: <if delegated to caller — name the invariant explicitly>.
// PROOF: <link to the invariant doc + the enforcement site>.
unsafe { ... }
```

Minimum requirements:
- **At least 3 lines** of justification.
- **Names invariants by name** — "single-threaded" is not enough; cite the type-level marker (`PhantomData<*const ()>`), the runtime check (`debug_assert!`), or the doc that proves the invariant holds.
- **Cites the enforcing code or doc-section** — a link to `src/CLAUDE.md` "JS-thread-only" rule, an `unsafe trait` impl-walker site, or a Phase-1 audit row.

Reject (lint or PR review):
- One-line SAFETY comments
- "// SAFETY: trust me" / "// SAFETY: by construction"
- SAFETY blocks that only restate the line of code below them

Gold-standard examples in-tree to imitate:
- `src/bundler/LinkerGraph.rs:96-97` — 96-line SAFETY block enumerating exactly which columns workers may touch through `&LinkerGraph`
- `src/options_types/context.rs` (3 `pub unsafe fn` over `*mut Log`) — names every aliasing path
- `src/runtime/dns_jsc/dns.rs:3650-3658` (`ResolverRefGuard`) — RAII chokepoint cited as canonical for `_not_send: PhantomData`
- `src/runtime/socket/udp_socket.rs:1207-1212` — `vec![…; len]` zero-init naming the EXP-005 hazard
- `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637` — canonical S4 `*mut Self + ThisPtr + ref_guard` pattern (EXP-012 RESOLVED exemplar; propagate to EXP-026/044/F-21-2)

## rustc -W flags to enable workspace-wide

Add to `.cargo/config.toml` or top-level `RUSTFLAGS`:

```toml
[build]
rustflags = [
  "-W", "unsafe_op_in_unsafe_fn",
  "-W", "unused_unsafe",
  "-W", "invalid_reference_casting",     # currently silenced at EXP-042/043 — flipping = free audit gain
  "-W", "dangling_pointers_from_temporaries",
  "-W", "improper_ctypes",
  "-W", "improper_ctypes_definitions",
]
```

The lint `invalid_reference_casting` directly catches EXP-042 (`repl::vm_mut`) and EXP-043 (`Scanner::resolve_dir_for_test`) — both sites have `#[allow(invalid_reference_casting)]` annotations today. Removing the silencers and fixing the resulting compile errors is the R-EXP-042 / R-EXP-043 remediation in `phase8_remediation_plan.md`.

## Clippy lint group

```bash
cargo clippy --all-targets -- \
  -W clippy::undocumented_unsafe_blocks \
  -W clippy::multiple_unsafe_ops_per_block \
  -W clippy::cast_ptr_alignment \
  -W clippy::ptr_as_ptr \
  -W clippy::transmute_undefined_repr \
  -W clippy::transmute_int_to_bool \
  -W clippy::transmute_int_to_char \
  -W clippy::uninit_assumed_init \
  -W clippy::derive_ord_xor_partial_ord \
  -W clippy::derive_hash_xor_eq
```

Rationale:
- `undocumented_unsafe_blocks` enforces the SAFETY-comment template above.
- `multiple_unsafe_ops_per_block` forces SAFETY comments to be tightly scoped to one operation each.
- `transmute_*` plus validity-byte groups catch EXP-002 / EXP-003 / EXP-006 / EXP-035 / EXP-036 / EXP-051 disk / FFI byte materialisation hazards. EXP-036 is a `bool` bit-pattern bug, not an enum transmute.
- `uninit_assumed_init` catches EXP-001 / EXP-005 / EXP-034 / EXP-072.
- `derive_*_xor_*` catches F-L12-1/2/3 Hash/Eq correctness drift.

## "If you change X, re-run experiment EXP-Y" recipes

| If you touch... | Re-run | Notes |
|---|---|---|
| `src/collections/linear_fifo.rs` | EXP-001 | `MIRIFLAGS="-Zmiri-strict-provenance"`; niche `NonZeroU32` repro |
| `src/errno/linux_errno.rs` | EXP-002 | also covered by PR #30765 landing — close EXP-002 reproducer once merged |
| `src/install/lockfile/Package/Meta.rs` | EXP-003 + EXP-006 | feed tampered enum byte (`0x2a` in both current witnesses); both share `Meta::*` field-read path |
| `src/runtime/webcore/encoding.rs` | EXP-004 | `MIRIFLAGS="-Zmiri-symbolic-alignment-check"` |
| `src/install/yarn.rs` | EXP-005 | `MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-ignore-leaks"`; needs niche-bearing `DependencyVersionTag` |
| `src/install/lockfile/Tree.rs` | EXP-007 | feed tampered `dep_id` (`> deps.len()`) |
| `src/semver/lib.rs` | EXP-008 + EXP-009 | `MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri test --release` (release-mode only) |
| `src/bundler/Chunk.rs` / `LinkerContext.rs` / `linker_context/**.rs` | EXP-010 | Tree-Borrows model trace; triangulation recommended before merging changes; add Loom CI gate per Phase 8 triangulation |
| `src/picohttp/lib.rs` | EXP-011 | Tree-Borrows; also re-validate ASM disassembly |
| `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs` | EXP-012 | canonical exemplar — assert `ThisPtr + ref_guard` pattern still in place |
| `src/crash_handler/lib.rs` | EXP-013 | POSIX signal-safety source-callgraph audit confirms the installed signal path reaches non-async-signal-safe operations; no Miri claim; EXP-071 static analyzer is the remediation vehicle |
| `src/collections/multi_array_list.rs` | EXP-014 | Tree-Borrows; non-Copy `Slice<T>` should refuse to compile second `ColMut` |
| `src/collections/array_hash_map.rs` | EXP-015 | Miri callsite audit; lint-silenced contract path |
| `src/ast/new_store.rs` + `Vec<T, AstAlloc>` consumers | EXP-016 | `MimallocArena::reset()` Drop-skip enumeration; current payload audit is NO_EVIDENCE for UB, EXP-066 is preventive hardening |
| `src/io/lib.rs` | EXP-017 | Source-overlap audit currently `NO_EVIDENCE`; keep the Miri primitive race model as a regression guard, fix the misleading `write_volatile + SeqCst` comment, and assert callback rewrites happen only while unscheduled |
| `src/threading/guarded.rs` | EXP-018 | autotrait test: `assert_impl_all!(GuardedLock<…, Mutex>: !Send)` |
| `src/ast/nodes.rs` (StoreSlice / StoreRef) | EXP-019 + EXP-021 | `Cell<u32>` cross-thread race; lifetime-erased dangling |
| `src/jsc/webcore_types.rs` / `src/runtime/webcore/Blob.rs` (`Blob::global_this`) | EXP-082 | default Miri; `Blob` must not expose safe `&JSGlobalObject` from a `Send + Sync` wrapper. Split JS-affine wrapper from cross-thread blob payload or make `global_this` unsafe/raw/thread-checked. |
| `src/runtime/shell/IOWriter.rs` / `src/runtime/shell/IOReader.rs` | EXP-083 | default Miri; safe `&self` mutators over `UnsafeCell<State>` must not be callable through a `Sync` shell IO handle. Remove `Sync` or serialize through an event-loop task handle. |
| `src/jsc/VirtualMachine.rs` (`unsafe impl Send/Sync`, `get_mut_ptr`, `as_mut`, `get_mut`) | EXP-084 | Miri `--release`; safe `&VirtualMachine` must not cross to a non-VM thread and then call safe unchecked TLS-backed mutation. Make VM JS-thread-affine, or make safe accessors checked and move unchecked TLS assumptions behind `unsafe fn`. |
| `src/bun_core/fmt.rs` (`Raw`, `raw`, `s`, `Display`) and byte-display call sites | EXP-085 | default Miri; safe display must not call `from_utf8_unchecked` on arbitrary bytes. Use lossy/escaped byte display, validation, or an `unsafe fn` constructor with a real UTF-8 contract. |
| `src/bun.rs` (`unsafe_assert`) | EXP-086 | default Miri; safe assertion helpers must not call `unreachable_unchecked` on caller-controlled booleans. Delete unused helper, make it `unsafe fn`, or use `panic!` / `unreachable!`. |
| `src/bundler/ThreadPool.rs` (`get_worker(&self, id) -> &'static mut Worker`, `Worker::get`) | EXP-087 | Tree-Borrows; safe duplicate calls for the same `ThreadId` must not produce two live `&mut Worker`s. Return raw `NonNull<Worker>` with local unsafe reborrows, or use a non-escaping `WorkerGuard` / closure API. |
| `src/ast/e.rs` (`E::String::init_utf16`, `slice16`) and UTF-16 string callers in `js_parser`, `json_lexer`, `yaml` | EXP-088 | Symbolic-alignment/provenance Miri; do not store a byte slice narrowed to `len_u16` bytes and later retag it as `len_u16` UTF-16 code units. Store typed UTF-16 data or a full-byte-length representation. |
| `src/bun_core/util.rs` (`PathBuffer::uninit`, `WPathBuffer::uninit`) and `src/install/lockfile/Tree.rs` (`depth_buf_uninit`) | EXP-089 | Default Miri invalid-value check; safe constructors must not return primitive arrays from fresh uninitialized storage. Use zeroed arrays immediately, or a `MaybeUninit<[T; N]>` scratch-buffer wrapper with initialized-prefix accessors. |
| `src/http/h3_client/encode.rs` (`Vec<quic::Header>::set_len(4)` prefix-fill) | EXP-090 | NO_EVIDENCE regression guard. Current no-Drop `quic::Header` shape Miri-checks clean, but rerun if `Header` gains `Drop`, validity-bearing fields with old-slot reads, or any read of pseudo-header slots before lines 96-107 initialize them. |
| `src/jsc/bindgen.rs` (`BindgenArray<Child>::convert_from_extern`) | EXP-091 | Default Miri allocator-layout check; safe generic conversion must not return `Vec<ZigType>` over storage allocated as `Vec<ExternType>` unless the eventual `Vec<ZigType>` deallocation layout matches the original allocation layout. Reuse layout-equal storage only; allocate fresh otherwise. |
| `src/runtime/webcore/streams.rs` (`ReadResult::Read` / `to_stream`) | EXP-092 | Default Miri allocator-ownership check; safe code must not be able to turn a raw borrowed/stack/foreign slice into `StreamResult::Owned(Vec<u8>)`. Split owned allocation tokens from borrowed raw slices; pointer inequality from `buf` is not an ownership proof. |
| `src/exe_format/pe.rs` (`view_at_const` / `view_at_mut`, section-header slices, `utils::is_pe`) | EXP-093 | Symbolic-alignment Miri; do not materialise `&T`, `&mut T`, or `&[SectionHeader]` from arbitrary PE byte offsets unless the offset is explicitly aligned for `T`. Prefer `read_unaligned` / byte-copy parsing for PE headers. |
| `src/bun_core/deprecated.rs` (`DoublyLinkedList<T>`) | EXP-094 | Default Miri / Stacked Borrows; the in-tree `basic_doubly_linked_list_test` is the reproducer. Prefer deleting this deprecated intrusive list if unused; otherwise require pinned/list-owned nodes so callers cannot re-mint `&mut node` while raw links remain live. |
| `src/exe_format/macho.rs` (`section_64` slices, load-command mutation at `update_load_command_offsets`) | EXP-095 | Symbolic-alignment Miri; `LoadCommand::cast<T>()` is sound because it returns owned values via `read_unaligned`, but mutation must not materialise `&mut T` / `&mut [T]` over byte-backed command storage. Use by-value `read_unaligned` / `write_unaligned` edits. |
| `src/url/lib.rs` | EXP-020 | `MIRIFLAGS="-Zmiri-strict-provenance"` |
| `src/runtime/timer/mod.rs` / `src/runtime/jsc_hooks.rs` | EXP-026 | Tree-Borrows model; re-entrant `&mut self`; S4 / EXP-061 vehicle |
| `src/runtime/node/dir_iterator.rs` | EXP-027 | Windows `RawSlice<u16>` sendability; cross-platform if migrated to S5 owned-result template |
| `src/sys/lib.rs` (`bun_sys::dir_iterator`) | EXP-081 | default Miri; POSIX `WrappedIterator::next` must not return a lifetime-erased `Name` that can outlive the iterator buffer |
| `from_field_ptr!` call sites that still materialise `&mut Parent` | F-A-2 cluster / EXP-069 | Tree-Borrows; production-caller harness owed. EXP-028 itself is now `NO_EVIDENCE`: canonical `dev_server::DirectoryWatchStore` already returns raw and the TODO-marked file is a stale Phase-A draft module with no call sites. |
| `src/runtime/shell/EnvStr.rs` | EXP-029 | `MIRIFLAGS="-Zmiri-strict-provenance"` |
| `src/threading/ThreadPool.rs` | EXP-030 (loom) | 10⁴+ iterations; sanity test for race must fire |
| `src/runtime/bake/DevServer/WatcherAtomics.rs` | EXP-031 (loom) | triple-buffer model |
| `src/jsc/web_worker.rs` | EXP-032 (loom) | 3-thread model; also owed Miri/TB follow-up for the `!Sync` type-system claim |
| `src/threading/channel.rs` | EXP-033 (Miri) + F-DR-2 (loom 2P-1C) | `Channel<bool>`-shape uninit `&mut [T]` validity witness |
| `src/install/migration.rs` | EXP-034 | same shape as EXP-005 |
| `src/standalone_graph/StandaloneModuleGraph.rs` | EXP-035 | feed tampered Mach-O `__BUN` section; 4 sparse enums × 256^4 |
| `src/install/lockfile/bun.lockb.rs` + `lockfile.rs` (`read_array`) | EXP-036 | feed `0xff` to `patchfile_hash_is_null: bool` |
| `src/watcher/WindowsWatcher.rs` | EXP-037 | regression guard: current `Action` decode is checked at `:196-211`; alert if direct enum materialization returns |
| `src/jsc/any_task_job.rs` | EXP-038 | panic-injection inside `C::run`; assert `LIVE_JOBS == 0` and `teardown_enqueues == 1` |
| `src/runtime/socket/Listener.rs` | EXP-039 | unwind-regression guard only today: panic-injection between `ptr::read` and `mem::forget` double-drops `Handlers` in an unwind-enabled model; Bun's configured profiles abort, and only the `:235` / `:317` sites have the allocation-prone pre-`mem::forget` window |
| `src/runtime/webcore/s3/simple_request.rs` | EXP-040 | panic-injection in Drop's `assume_init_mut` path; current production path leaks instead of dropping; trip-hazard only fires if a reclaim-on-unwind scopeguard lands — currently NO_EVIDENCE for production UB |
| `src/runtime/server/WebSocketServerContext.rs` + 10 siblings (subprocess, Terminal, cron, node_fs_watcher, node_fs_stat_watcher, interpreter, JSTranspiler, dns, socket_body, h2_frame_parser) | EXP-041 | Tree-Borrows on `addr_of!.cast_mut()` count writes; mechanical fix is `AtomicUsize` Relaxed across all 11 sites |
| `src/runtime/cli/repl.rs` (`vm_mut`) | EXP-042 | Tree-Borrows on `from_ref(&vm).cast_mut(); &mut *p` — also caught by `-W invalid_reference_casting` |
| `src/runtime/cli/test/Scanner.rs` | EXP-043 | same shape as EXP-042 |
| `src/bundler/bundle_v2.rs` (`self.bv2`) | EXP-044 | Tree-Borrows + plugin re-entry harness; triangulation recommended; per Phase 8 triangulation, rename `bv2_mut → bv2_ptr` (unsafe fn) and add a `bun-plugin-mdx`-style re-entry regression test |
| `src/jsc/JSCell.rs` (`JsCell<T>`) | EXP-045 | Miri data-race witness + compile-fail after bounded impl |
| `src/jsc/WorkTask.rs` / `ConcurrentPromiseTask.rs` | EXP-046 | impl-walker; classify owned-vs-raw context, worker-side field touches, drop thread, panic path before claiming live UB |
| `src/bun_core/atomic_cell.rs` (`ThreadCell<T>`) + `src/bun_core/util.rs` (`RacyCell<T>`) + every `RacyCell<X>` instantiation | EXP-047 | hardening-only after safe-boundary correction: old Miri race required caller-side `unsafe`; keep workspace payload/access audit for load-bearing `!Sync` instantiations |
| `src/ptr/tagged_pointer.rs` | EXP-048 (centralised provenance fix; S2) | `MIRIFLAGS="-Zmiri-strict-provenance"`; fixes the true `TaggedPtr::get/to` helper and true `TaggedPtrUnion` callers. Adjacent custom packers (F-P-8/F-P-9/F-P-10/F-P-11) and layout-only rows (F-P-7/F-P-12) need per-site decisions. |
| `src/bun_core/string/immutable.rs` (`StringOrTinyString`) | EXP-049 | byte-buffer-as-ptr Miri strict mirror; **NOT closed by S2** — needs separate representation rewrite (byte-buffer → typed thin-pointer) |
| `src/bun_core/string/SmolStr.rs` (`SmolStr`) | EXP-096 | packed-`u128` pointer-bit Miri strict mirror; **NOT closed by S2** — needs separate representation rewrite (typed pointer + len/cap/tag metadata) |
| `src/bun_alloc/lib.rs` (`ZigString` tag-bit) | EXP-050 | EnvStr-shaped Miri strict mirror; **NOT closed by S2** — JSC ABI cross-boundary, needs separate representation rewrite |
| `packages/bun-native-plugin-rs/src/lib.rs` (`BunLoader`) | EXP-051 | hostile-host-input proptest; public FFI. Per Phase 8 v2 triangulation, use **option D: compatibility-first checked conversion** — keep `output_loader(&self) -> BunLoader` source-compatible, remove the transmute by routing through a checked conversion, add `try_output_loader -> Result<BunLoader, InvalidLoader>`, and deprecate the legacy method. Avoid both flag-day return-type change and safe-fn-to-unsafe-fn source break. |
| `src/threading/unbounded_queue.rs` | EXP-052 (loom 2P-1C) | lock-free MPSC `Relaxed` swap synchronisation; regression-guard model now on file |
| `src/io/source.rs` (`Source::get_handle` / `to_stream`) | EXP-053 | `NO_EVIDENCE` for current UB; keep as layout-drift hardening. Replace direct `.cast()` with `UvHandle::as_handle_mut()` / `UvStream::as_stream()` so future prefix drift fails at compile time. |
| `src/runtime/napi/napi_body.rs` (POD structs) | EXP-054 | C-side reflector + build script; layout asserts; PoC at `experiments/layout_asserts/napi.rs`; LP64 cross-check passed, so EXP-063 is the cluster-wide hardening vehicle |
| `src/libuv_sys/libuv.rs` (`HandleType` enum) | EXP-055 | per-variant `const _: () = assert!(...)` generator; current C/Rust enum cross-check passed, so this is hardening |
| `src/runtime/server/NodeHTTPResponse.rs` zero-ref release | EXP-056 | Confirmed by Miri Tree Borrows: `deref(&self)` reaches `deinit(&self)` and deallocates through `self.as_ctx_ptr()`, a pointer derived from shared/read-only provenance. Move the zero path to an original/raw pointer release shape (`CellRefCounted::deref(this: *mut Self)` model). |
| Any `fn(&self) -> &'a mut T` (17-site cluster) | EXP-057 | Tree-Borrows double-call witness per site |
| `src/bun_core/output.rs` (`source_writer_escape` + 5 wrappers) | EXP-058 | Miri Tree-Borrows two-call witness; structural fix is `with_*_writer` / `WriterGuard<'_>` migration |
| `src/bun_alloc/lib.rs` (`Mutex::new()` consumers) | EXP-059 | API-misuse witness; stack-construction hazard — BSS instances sound today |
| `src/runtime/napi/napi_body.rs` (`ThreadSafeFunction` protocol) | EXP-060 | Miri raw-handle witness confirmed; rewrite exported producer-thread wrappers to avoid `&mut *func`; Shuttle only for finalizer/env-teardown follow-up |
| `src/collections/hive_array.rs` + 8 callers in `src/install/PackageManager/PackageManagerEnqueue.rs:358,1659,1803`, `src/install/PackageManager/runTasks.rs:1711`, `src/runtime/server/server_body.rs:3415`, `src/runtime/server/mod.rs:705`, `src/runtime/bake/DevServer.rs:2097`, `src/runtime/api/bun/h2_frame_parser.rs:7375` | EXP-072 | one-PR-per-crate caller migration to `get_init` / `emplace` / `claim`; after both crates land, delete the `#[deprecated]` methods entirely |
| `src/runtime/webcore/blob/copy_file.rs` (`CopyFileWindows.event_loop`) | EXP-073 | default Miri + Tree-Borrows; store raw `*mut EventLoop` like `WriteFileWindows` (mechanical isomorphic fix from the sibling Windows writer) |
| `src/runtime/timer/timer_object_internals.rs` (`TimerObjectInternals::parent_ptr` / `event_loop_timer` / `set_event_loop_timer_state`) | EXP-074 | default Miri + Tree-Borrows; promote `EventLoopTimer.state` to interior-mutability or carry raw parent/timer provenance for the mutable writes (mirrors EXP-073 Bucket-14 fix shape) |
| `src/runtime/bake/DevServer.rs` (`DeferredRequest.dev` backref) | EXP-075 | default Miri + Tree-Borrows; store `std::ptr::from_mut(self)` / `NonNull::from(self)` in `try_define_deferred_request` instead of `std::ptr::from_ref(self)` |
| `src/runtime/socket/WindowsNamedPipeContext.rs` (`vm` backref / `deinit_in_next_tick`) | EXP-076 | default Miri + Tree-Borrows; do not call `VirtualMachine::enqueue_task(&mut self)` through `ptr::from_ref(vm).cast_mut()` — enqueue via the VM-owned event-loop projection or a dedicated shared-VM enqueue wrapper |
| `src/css/css_parser.rs` (`ToCssResult` / CSS module exports + references) | EXP-077 | default Miri; carry the bump lifetime in `ToCssResult<'bump>` / `ToCssResultInternal<'bump>` or deep-copy CSS module metadata into owned storage before returning |
| `src/bun_core/util.rs` (`ArrayLike::set_len_and_slice`) | EXP-078 | default Miri; make `set_len_and_slice` `unsafe fn` with an initialization contract, or replace it with an initializer API that never exposes `&mut [T]` over uninitialized storage |
| `src/bundler/transpiler.rs` (`Transpiler::env_mut`) | EXP-079 | Tree-Borrows Miri; return a raw pointer / closure-scoped accessor, or tie the mutable loader borrow to `&mut self` so safe callers cannot mint two coexisting `&mut Loader`s |
| `src/dispatch/lib.rs` (`bun_dispatch::link_interface!`) or any generated dispatch handle | EXP-080 | default Miri; generated handle fields must be private so safe code cannot bypass `unsafe fn new` with a forged `kind`/`owner` pair |
| `src/sys/lib.rs` (`WrappedIterator`, `IteratorResult`, `Name`) | EXP-081 | default Miri; rerun if changing POSIX directory iteration result ownership/lifetimes or `Name::slice*` accessors |
| `src/jsc/webcore_types.rs` (`Blob` Send/Sync + `global_this`) | EXP-082 | default Miri; rerun if changing Blob auto-traits, ObjectURLRegistry/task transport types, or any accessor that returns `&JSGlobalObject` |
| `src/runtime/shell/IOWriter.rs` / `src/runtime/shell/IOReader.rs` (`unsafe impl Sync`, `state()`, public mutators) | EXP-083 | default Miri; rerun if changing shell IO auto-traits, `Arc` ownership, or any `&self` method that mutates `State` |
| `src/jsc/VirtualMachine.rs` (`unsafe impl Send/Sync`, safe `as_mut()` / `get_mut()`) | EXP-084 | Miri `--release`; rerun if changing VM auto-traits, TLS accessors, or any API that lets `&VirtualMachine` cross threads. |
| `src/bun_core/fmt.rs` and callers of `fmt::s` / `fmt::raw` | EXP-085 | default Miri; rerun if changing byte-formatting behavior, path/tarball-name display, package-manager command echoing, or any code that pipes non-`str` bytes through `Display`. |
| `src/bun.rs` (`unsafe_assert`) | EXP-086 | default Miri; rerun if adding any caller or changing assertion helpers. Prefer deletion while it remains unused. |
| `src/runtime/node/node_cluster_binding.rs` / `src/jsc/ipc.rs` | EXP-099 | Tree-Borrows; callback-running singleton flush paths must not carry a protected `&mut self` receiver across JS callback re-entry. |
| `src/runtime/socket/UpgradedDuplex.rs` + `src/uws_sys/lib.rs` opaque shims | EXP-100 | Tree-Borrows; SSLWrapper callbacks must not materialize a whole-struct `&mut UpgradedDuplex` while an SSLWrapper field borrow is live. |
| `src/http/ProxyTunnel.rs` (`shutdown(&mut self)`, `write(&mut self, buf)`, `on_writable(&mut self, ...)`, `receive(&mut self, ...)`) and callers in `src/http/lib.rs` / `src/http/HTTPContext.rs` | EXP-101/102/103 | Tree-Borrows; the disjoint-field callback pattern is sound only when the entry path is raw-owner too. Rerun if touching proxy tunnel shutdown/write/on_writable/receive paths or SSLWrapper callback accessors. |
| `src/runtime/socket/WindowsNamedPipe.rs` (`WRAPPER_BUSY` + SSLWrapper-driving `&mut self` entries) and `src/jsc_macros/lib.rs` generated `#[uws_callback]` receiver thunk | EXP-104 | Tree-Borrows; keep `WRAPPER_BUSY` for wrapper lifetime, but exported thunks and internal receive/start helpers must not hold a whole-struct `&mut WindowsNamedPipe` while entering SSLWrapper. Rerun if touching named-pipe TLS, `WRAPPER_BUSY`, or `#[uws_callback]` receiver generation. |
| `src/io/PipeWriter.rs` (`_on_write(&mut self)`, `on_write_complete(&mut self, ...)`) and `src/runtime/webcore/FileSink.rs` parent callbacks | EXP-106 | Tree-Borrows; writer completion paths must not keep a protected `&mut self` receiver alive while `Parent::on_write` / `FileSink::on_write` can re-enter `writer.with_mut`. Keep the parent `borrow = ptr` discipline, but make the writer entry path raw-owner too. |
| `src/jsc/rare_data.rs` (`close_all_watchers_for_isolation(&mut self)`) and watcher registration/removal in `src/runtime/node/node_fs_watcher.rs` | EXP-107 | Tree-Borrows; watcher close callbacks can re-enter JS and push back into the same watcher vectors. The cleanup loop must not carry an `&mut RareData` receiver across close callbacks. |
| `src/jsc/event_loop.rs` (`run_callback(&mut self)`, `run_callback_with_result(&mut self)`) and host exports | EXP-108 | Tree-Borrows; JS callbacks can re-enter `vm.event_loop()` and run nested `enter()/exit()` while the outer callback runner still protects its receiver. Callback-running event-loop entries should be raw-owner helpers. |

## Idea-wizard infrastructure recommendations (EXP-061..EXP-071)

The Phase 6 idea-wizard surfaced 11 vehicle EXPs — each is a structural
infrastructure investment that closes multiple bug-class findings at once. They
are tracked as `DEFERRED`, not `OPEN`, because implementation work remains but
no unresolved UB proof obligation remains in the registry:

| EXP | Investment | Closes / hardens |
|-----|------------|------------------|
| EXP-061 | `#[bun_callback]` proc-macro synthesising `ThisPtr + ref_guard + raw-place projection` | EXP-026, EXP-044, F-21-2 (S4 mechanised) |
| EXP-062 | `JsThreadAffine` sealed marker trait — compile-error on cross-thread JS capture | 4-layer chain VM/JsCell/WebWorker/BackRef |
| EXP-063 | `#[layout_locked]` derive + C-reflector build-script | EXP-054 + F-10-4 + F-10-5 (NAPI/Win32/BoringSSL ~63 structs) |
| EXP-064 | `#[const_validate]` enum / validity derive auto-inserting checked bit-pattern validation | EXP-002 + EXP-003 + EXP-006 + EXP-035 + EXP-036 + EXP-051 + EXP-097 — mechanical validity-family pass; EXP-037 is already resolved by checked match. EXP-097's immediate fix can be simpler than a derive: route safe errno `from_raw` through existing checked `from_repr` / `try_from_raw`. This does not change the S6 boundary: `Buffers::read_array<T>` closes EXP-036, while EXP-003/006 still need checked `Meta` decoding at `Package::load_fields`. |
| EXP-065 | Re-entrant-VM tripwire (`re_entry_count: Cell<u32>` debug field) | EXP-026 + EXP-042 + EXP-043 + EXP-044 runtime witness |
| EXP-066 | `BumpDrop<T: Drop>` arena-drop wrapper | Prevents future EXP-016-class drift; current EXP-016 evidence is leak-only / NO_EVIDENCE for UB |
| EXP-067 | `Ref(NonZeroU64)::normalize()` accessor with compile-error-on-unmasked-hash | F-L12-1 correctness drift |
| EXP-068 | `bun_core::heap` chokepoint workspace lint (forbid `Box::leak` outside `heap::*`) | F-L-11 9-site `Box::leak` cluster |
| EXP-069 | Loom + Shuttle 95-site `from_field_ptr!` re-entry torture harness | F-A-2 cluster-wide dynamic oracle |
| EXP-070 | `impl_streaming_writer_parent!` re-entry-mode annotation linter | Generalises Section P `RawPtrHandler<T>` escape hatch |
| EXP-071 | Signal-handler async-signal-safety static analyzer | Promotes EXP-013 from comment-TODO to compile-time wall |

These are recommended Phase-11+ landing targets; each one collapses a workshop of per-site fixes into a single structural mechanism.

## Strict-provenance migration path

Six EXPs fail under `-Zmiri-strict-provenance` (EXP-020, EXP-029, EXP-048, EXP-049, EXP-050, EXP-096). The four high-blast-radius representation entries below are **not** equivalent and don't share a single fix:

- **EXP-048 — Centralised TaggedPtr fix (S2 structural).** Scope: `src/ptr/tagged_pointer.rs:53-64`. A typed pointer representation fixes EXP-048 / F-P-4 and true `TaggedPtrUnion` callers. `ptr::with_exposed_provenance` is only an interim annotation of the exposed-address dependency; it does not close the strict-provenance gate. This remains the lowest-friction structural win, but it does not automatically fix custom packed-pointer rows such as F-P-8/F-P-9/F-P-10/F-P-11 or layout-only integer-as-value rows F-P-7/F-P-12.
- **EXP-049 — `StringOrTinyString` (separate representation rewrite).** `src/bun_core/string/immutable.rs:1076` reconstructs a pointer from a raw `usize::from_le_bytes` byte buffer. Closing this requires changing `StringOrTinyString`'s internal representation — likely a typed pointer plus length sentinel — not just a strict-provenance helper switch.
- **EXP-050 — ZigString (separate representation rewrite).** `src/bun_alloc/lib.rs:925..946` tag-bit mark/untag is the **hot path for the Bun↔JSC string ABI**. The C++ side originates pointer-shaped values across the FFI; closing this requires coordination with JSC ABI consumers, not just Rust-side `with_exposed_provenance`. Treat as a deep representational change, not a Cluster-D fix.
- **EXP-096 — `SmolStr` (separate representation rewrite).** `src/bun_core/string/SmolStr.rs` stores a heap pointer in the upper 64 bits of a `u128` and reconstructs it in `ptr()` / `ptr_const()`. Closing this requires changing the exported `SmolStr` representation to carry a typed pointer (for example a heap variant with `NonNull<u8>` plus len/cap/tag metadata), not reusing EXP-049's byte-buffer fix.

Adopt strict-provenance as a CI gate only after S2 and the per-site migration plan are explicit. Mark EXP-020/EXP-029/EXP-049/EXP-050/EXP-096 as known strict-provenance failures with targeted `// SAFETY:` annotations and local allowlisting until their representation rewrites land.

## HiveArray / HiveArrayFallback 8-caller migration path (EXP-072)

`src/collections/hive_array.rs` has 4 deprecated raw-slot methods returning `*mut T` to uninit memory: `HiveArray::get` plus `HiveArrayFallback::{get, try_get, get_and_see_if_new}`. The author already shipped the replacement API (`get_init` / `emplace` / `claim`) and explicitly self-acknowledged the bug class via the `#[deprecated]` message "returns *mut T to uninitialized memory; use get_init / emplace / claim". `experiments/EXP-072` now confirms the exact early-return-before-write hazard under Miri: a claimed-but-unwritten slot is later dropped as initialized `T`, producing an uninitialized-memory UB report.

Landing path: **one PR per crate**, then delete the deprecated methods entirely.

**Crate 1: `bun_install` (4 callers)**
- `src/install/PackageManager/PackageManagerEnqueue.rs:358` — `.get()` → `preallocated_resolve_tasks`
- `src/install/PackageManager/PackageManagerEnqueue.rs:1659` — `.get()` → `preallocated_resolve_tasks`
- `src/install/PackageManager/PackageManagerEnqueue.rs:1803` — `.get()` → `preallocated_resolve_tasks`
- `src/install/PackageManager/runTasks.rs:1711` — `.get()` → `preallocated_network_tasks`

**Crate 2: `bun_runtime` (4 callers)**
- `src/runtime/server/server_body.rs:3415` — `.get()` on `request_pool: RequestContextStackAllocator = HiveArrayFallback<RequestContext<...>, 2048>`
- `src/runtime/server/mod.rs:705` — `.try_get()` on `request_pool: RequestContextStackAllocator = HiveArrayFallback<RequestContext<...>, 2048>`
- `src/runtime/bake/DevServer.rs:2097` — `.get()` on `deferred_request_pool: HiveArrayFallback<deferred_request::Node, DeferredRequest::MAX_PREALLOCATED>`
- `src/runtime/api/bun/h2_frame_parser.rs:7375` — `.try_get()` on `H2FrameParserHiveAllocator = HiveArrayFallback<H2FrameParser, 256>`

After both PRs land, delete `HiveArray::get` and `HiveArrayFallback::{get, try_get, get_and_see_if_new}` from `bun_collections::hive_array`. The replacement API enforces init-before-deref by construction; companion EXP-001 (`assume_init_slice`) is the sibling helper in the same UB family.

Caller-audit nuance: the Miri witness confirms the generic API contract, not eight separately-proven production crash paths. Some current callers immediately write a full value or deliberately use `put_raw` before initialization. That makes the remediation still high-value but keeps the public claim defensible: migrate the API because it admits UB, then do per-caller proof only if arguing exploitability.

## EXP-051 remediation note (CHANGED vs Phase 8 architect plan)

Per Phase 8 v2 triangulation (`phase8_triangulation.md`): the architect's
implicit flag-day return-type swap for `BunLoader::output_loader` is rejected,
and the v1 "mark the legacy method `unsafe fn`" coexistence plan is also
rejected because safe-fn-to-unsafe-fn is a source-compatibility break. **Use
option D: compatibility-first checked conversion.**

1. Keep `pub fn output_loader(&self) -> BunLoader` source-compatible and safe,
   but remove the `transmute` immediately by routing through a checked byte to
   `BunLoader` conversion.
2. Add `pub fn try_output_loader(&self) -> Result<BunLoader, InvalidLoader>` as
   the new recommended API, implemented via hand-written `try_from` against
   `#[repr(u8)] enum BunLoader { ... }` (or `bytemuck::CheckedBitPattern` derive —
   both correct; choose by team style preference).
3. Deprecate the legacy `output_loader` method with migration guidance. For an
   invalid host byte, choose a documented safe legacy behavior: either a
   precise panic ("host returned invalid loader byte") or a sentinel default
   plus warning. Both are sound; the policy choice is release-management.
4. Plan removal or tightening in the next major if the maintainers want a
   fallible-only public surface.

**Rationale:** `bun-native-plugin-rs` is published on crates.io; every native
Bun plugin author depends on the current `output_loader -> BunLoader` API
shape. A flag-day return-type swap silently breaks every downstream plugin
without warning. Marking the legacy method `unsafe fn` would also break every
caller at compile time and still leave misuse possible. The compatibility-first
checked conversion removes the UB while preserving source compatibility. The
C++-mirror question is moot — the C++ side already treats `loader` as `u8`, so
`#[repr(u8)]` on the Rust side **improves** ABI fidelity, not regresses it.

## How to run the full audit again

**Drift note (Codex 2026-05-16):** this run was pinned to
`origin/main@4d443e5402`. A later fetch found `origin/main@e750984db6`,
including a broad hardening commit (`e520065ebb`). Before treating the 70
confirmed pinned-base entries as latest-main live findings, run the W4 refresh described in
`CODEX_MAIN_DRIFT_NOTE_2026-05-16.md`.

```bash
# Re-run this skill against current main
/rust-undefined-behavior-exorcist
# Mode: Exhaustive
# Prior baseline: /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/ (this run)
# Branch: claude/ub-exorcist-audit-<date>-N
```

The skill will:
1. Read this run's `phase0_run.json` + `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` registry as Phase-0 anchored witnesses.
2. Re-verify the 70 registry `CONFIRMED_UB` entries are still reproducible against current source.
3. Survey for new finding shapes the prior pass didn't see (regression candidates + new code).
4. Implement deferred remediation / CI vehicles: EXP-061..EXP-071 are no longer open proof obligations; they are `DEFERRED` implementation projects. EXP-013, EXP-046, EXP-056, EXP-097, EXP-098, EXP-099, EXP-100, EXP-101, EXP-102, EXP-103, EXP-104, EXP-106, EXP-107, EXP-108, EXP-110, and EXP-111 are now `CONFIRMED_UB`; per-context hardening for EXP-046/056 still belongs in the remediation plan, EXP-097 should be bundled with the errno checked-conversion work, EXP-098 should join the bounded-auto-trait cleanup, and EXP-099/EXP-100/EXP-101/EXP-102/EXP-103/EXP-104/EXP-106/EXP-107/EXP-108/EXP-110 should be bundled with the callback-running receiver cleanup (`flush(this: *mut Self)` / short-scoped reborrows / disjoint-field SSLWrapper callbacks / removal of stale `&mut self` wrapper methods / raw-owner writer completion paths). EXP-104 is specifically the `WindowsNamedPipe` variant: keep `WRAPPER_BUSY` for wrapper lifetime/UAF prevention, but do not rely on it to solve receiver-protector aliasing. EXP-106 is specifically the `PipeWriter` / `FileSink` variant: the parent `borrow = ptr` side is correct, but the writer entry path must also stop using a long-lived `&mut self` receiver around callback-capable parent dispatch. EXP-107/108/110 are the `RareData` watcher cleanup, core EventLoop callback-runner, and h2 stream queue-frame variants of the same rule. EXP-111 should be handled with EXP-010 as a bundler part-range fan-out fix: remove concurrent whole-owner `&mut LinkerContext` / `&mut Chunk` worker entries, then make renamer/follow lookups shared/read-only. A renamer-only patch does not close EXP-111. EXP-109 is `NO_EVIDENCE` for the original `JSCallback` GC-root-loss hypothesis after source review showed the production callback path owns a `FFICallbackFunctionWrapper` with `JSC::Strong<JSFunction>` and `JSC::Strong<GlobalObject>`; keep only a regression-test idea and duplicate-scaffolding cleanup note. The strict-provenance migration entries EXP-020, EXP-029, EXP-048, EXP-049, EXP-050, and EXP-096 are `DEFERRED` release-gate work, not missing production-UB proofs.
5. Open the Phase-11 SOAK campaigns spec'd at `phase11_soak_designs.md` (5 campaigns + layout-assert CI gate; worker-a/worker-b workers, 16 concurrent slots).

## Provenance

This runbook is the persistent output of run `2026-05-15-exhaustive` (v2 refresh). The transient outputs (per-section Phase 1 notes, per-bucket Phase 2 findings, per-experiment Phase 5 logs, the 182-row unified findings table, the 106-entry experiment registry, Phase 11 incidental-findings + cargo-audit + path-b Miri logs) live alongside in `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/`. The companion point-in-time audit findings are in [`FINAL_UB_REPORT.md`](./FINAL_UB_REPORT.md).

The skill that produced both files is [`/rust-undefined-behavior-exorcist`](https://jeffreys-skills.md/skills/rust-undefined-behavior-exorcist), composed on top of the prior [`/rust-unsafe-code-exorcist`](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist) audit that established the 5 Miri-confirmed witnesses + 6 ceiling-score supply-chain primitives baseline.
