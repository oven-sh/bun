# Beads to create (Phase 8)

Bead-creation commands prepared for Phase 11. **NOT YET EXECUTED.** When the user authorizes bead-filing, these commands run against `.beads/` (creates a new beads store if none exists).

For each cluster, the bead graph is:
- **Parent epic bead** with the cluster summary
- **Per-PR implementation beads** (the cluster's PR landing order)
- **Pre-existing-UB beads** for the latent bugs found (highest priority)

Codex pass 2 amendments:
- C-001 headline count is **22+ firm**, not 23, until the `const fn` site is excluded or solved.
- C-002 should use `strum::FromRepr`, not `num_enum`.
- C-003 should not assume `static_assertions` is already available; use Bun's no-dependency auto-trait proof pattern or explicitly add the dependency.
- B-cluster beads are measurement-gated; "B-PROVEN-HOT" is not final until benchmark logs are attached.
- Add one focused bead for the Windows `BundleThread` stale waker placeholder branch.

Codex pass 3 amendments:
- Add P0/P1 design beads for cross-thread task context traits lacking `Send` or
  `unsafe trait` boundaries.
- Add P1 design bead for `Output::*writer()` returning safe aliasable
  `&'static mut`.
- Add P1/P2 design bead for thread-local / FFI scratch-buffer APIs returning
  references whose true lifetime is only "until next call".
- Add P2 watchlist beads for `PackageFilterIterator` self-reference,
  package-manager `&'static mut NetworkTask` task slots, and `CopyFile<'a>`'s
  unsound `JSGlobalObject` lifetime.

## P0 — Pre-existing-UB beads (file first, fix first)

### pre-existing-ub-001 — linux_errno.rs `impl GetErrno for usize`

```bash
br create \
  --priority 1 \
  --title "[pre-existing-ub] linux_errno.rs: impl GetErrno for usize transmutes unbounded usize to SystemErrno enum (S-001781)" \
  --labels "pre-existing-ub,unsafe-audit,soundness-bug,linux" \
  --description "$(cat <<'EOF'
**File:** src/errno/linux_errno.rs:175-188
**Site ID:** S-001781

The `impl GetErrno for usize` transmutes `(int as u16) → E` where:
  - The SAFETY comment claims input range is the "kernel errno range [0, 4096)"
  - The target enum `SystemErrno` has DENSE discriminants only in `0..=133`

Adversarial input: any kernel return value in [134, 4095] (which exist —
EHWPOISON+1 = 134; up to 133+ on some kernels) → invalid discriminant → UB.

Status: NO LIVE CALLERS today (Bun's Linux raw-syscall layer returns
Result<T, i32> through rustix). But the function is `pub` in `bun_errno`,
and any future caller that follows the Zig porting reference verbatim
(`@as(usize, @bitCast(rc))` then `getErrno`) will reintroduce the bug.

**Fix (proposed in audit/plans/C-002-transmute-to-enum.md):**

```rust
// Add to enum definition (one-line change):
#[derive(strum::FromRepr, ...)]
#[repr(u16)]
pub enum SystemErrno { ... }

// Replace impl body (5-line change):
impl GetErrno for usize {
    fn get_errno<E: GetErrno>(self) -> E {
        let raw = if self > (0_usize.wrapping_sub(4096)) {
            (-(self as i32)) as u16
        } else { 0 };
        E::from_repr(raw).unwrap_or(E::SUCCESS)
    }
}
```

**Verification:** cargo +nightly miri test -p bun_errno --lib
EOF
)"
```

### pre-existing-ub-002 — `StoreSlice<T>` unconditional Send/Sync

```bash
br create \
  --priority 1 \
  --title "[pre-existing-ub] bun_ast::nodes::StoreSlice<T> unconditional Send/Sync impl lets !Send types cross threads" \
  --labels "pre-existing-ub,unsafe-audit,soundness-bug" \
  --description "$(cat <<'EOF'
**File:** src/ast/nodes.rs:339-340

```rust
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}
```

Sister type StoreRef<T> at lines 39-40 is correctly bounded:

```rust
unsafe impl<T: Send> Send for StoreRef<T> {}
unsafe impl<T: Sync> Sync for StoreRef<T> {}
```

The comment for StoreRef (lines 30-38) explicitly explains the discipline:
"Bounded on T so StoreRef cannot launder a !Send/!Sync payload."

The unconditional impl on StoreSlice lets StoreSlice<Cell<u32>> be Send
(and Sync — even worse since Cell is !Sync by design). The comment at
337-338 says "callers must not actually share a Store across threads" —
but discipline-by-comment doesn't survive auto-trait inference.

**Fix:**
```rust
unsafe impl<T: Send> Send for StoreSlice<T> {}
unsafe impl<T: Sync> Sync for StoreSlice<T> {}
```

Two-line patch. Matches the sister type's discipline.

**Risk consideration:** If any code path actually uses StoreSlice over a
!Send/!Sync T today, adding the bound is a breaking change. Verify via
cargo check before landing. (Audit's expectation: zero callers will break.)

**Verification:** add a compile-time negative proof that `StoreSlice<Cell<u32>>`
does not implement Send/Sync. Prefer Bun's existing no-dependency
auto-trait-ambiguity trick from `src/runtime/shell/subproc.rs` unless the
maintainer explicitly accepts `static_assertions`.
EOF
)"
```

### codex-p2-001 — Windows `BundleThread` waker placeholder

```bash
br create \
  --priority 2 \
  --title "[unsafe-audit] BundleThread::uninitialized still zeroes Windows Waker despite Async::Waker::placeholder()" \
  --labels "unsafe-audit,codex-pass2,windows,soundness-watchlist" \
  --description "$(cat <<'EOF'
**Files:**
- src/bundler/BundleThread.rs:136-155
- src/io/lib.rs:2171-2193

Codex pass 2 found that `Async::Waker::placeholder()` exists for Windows,
but `BundleThread::uninitialized()` still uses a cfg(windows)
`zeroed_unchecked()` branch under a stale TODO that calls the value
"technically invalid_value UB".

Fix:
```rust
waker: Async::Waker::placeholder(),
```

Then delete the stale Windows TODO/SAFETY block.

Verification:
- cargo check -p bun_bundler --target x86_64-pc-windows-msvc
- Preferred: bun run rust:check-all
EOF
)"
```

### codex-p3-001 — cross-thread task context traits need explicit unsafe/Send contract

```bash
br create \
  --priority 1 \
  --title "[unsafe-audit] cross-thread task traits run generic contexts on worker threads without Send/unsafe-trait boundary" \
  --labels "unsafe-audit,codex-pass3,soundness-design,threading,jsc" \
  --description "$(cat <<'EOF'
**Files:**
- src/jsc/any_task_job.rs
- src/jsc/ConcurrentPromiseTask.rs
- src/jsc/WorkTask.rs
- src/runtime/node/node_crypto_binding.rs
- src/threading/work_pool.rs

Safe traits (`AnyTaskJobCtx`, `ConcurrentPromiseTaskContext`, `WorkTaskContext`,
`CryptoJobCtx`) run user-supplied context code on work-pool threads, but the
traits do not require `Send` and are not `unsafe trait`. `owned_task!` also
emits `unsafe impl Send` over generic parameters without adding `Send` bounds.

This is a safe-API soundness defect. Current impls often rely on a narrow proof:
JS-affine fields are stored in the task but are inert on the worker and only
used/dropped on the JS thread. That proof must be encoded as an unsafe contract
or replaced by a worker-state / JS-completion-state split.

Plan: audit/plans/CODEX-P3-cross-thread-task-send-boundaries.md
EOF
)"
```

### codex-p3-002 — Output writer APIs return aliasable `&'static mut`

```bash
br create \
  --priority 1 \
  --title "[unsafe-audit] Output writer APIs expose known-unsound &'static mut references from TLS" \
  --labels "unsafe-audit,codex-pass3,soundness-design,aliasing" \
  --description "$(cat <<'EOF'
**File:** src/bun_core/output.rs:1067-1109

The source says these accessors are a "known-unsound shim":

  - error_writer() -> &'static mut io::Writer
  - error_writer_buffered() -> &'static mut io::Writer
  - error_stream() -> &'static mut io::Writer
  - writer() -> &'static mut io::Writer
  - writer_buffered() -> &'static mut io::Writer

Safe Rust can hold two live mutable references. The implementation escapes a
thread_local RefCell borrow through a raw pointer and trusts callers to use the
result briefly.

Plan: add closure APIs (`with_error_writer`, `with_writer`, ...), migrate easy
call sites, then downgrade the legacy APIs to unsafe/raw-pointer shape.

Plan: audit/plans/CODEX-P3-static-mut-lifetime-and-writer-aliasing.md
EOF
)"
```

### codex-p3-003 — scratch-buffer references have "until next call" lifetimes

```bash
br create \
  --priority 2 \
  --title "[unsafe-audit] thread-local/FFI scratch buffers escape as ordinary Rust refs" \
  --labels "unsafe-audit,codex-pass3,lifetime,threadlocal" \
  --description "$(cat <<'EOF'
Representative files:
- src/resolver/fs.rs:1724-1744 (`ModKey::hash_name`)
- src/http/lshpack.rs:32-105 (`HPACK::decode`)
- src/install/repository.rs:527-610 (`Repository::try_ssh`, `try_https`)
- src/paths/resolve_path.rs:1393-1407 (`normalize_string`, `normalize_string_z`)

These APIs return refs into thread-local or FFI scratch buffers where the true
contract is "valid until the next call on this thread" or "valid until next
decode/encode". Current call sites often duplicate immediately, but the safe
APIs themselves permit callers to keep refs across the next mutation.

Plan: caller-provided buffers, owned returns, closure APIs, or unsafe raw views.

Plan: audit/plans/CODEX-P3-static-mut-lifetime-and-writer-aliasing.md
EOF
)"
```

### codex-p3-004 — `PackageFilterIterator` is movable and self-referential

```bash
br create \
  --priority 2 \
  --title "[unsafe-audit] PackageFilterIterator stores a 'static iterator borrowing its sibling walker" \
  --labels "unsafe-audit,codex-pass3,self-referential,cli" \
  --description "$(cat <<'EOF'
**File:** src/runtime/cli/filter_arg.rs:40-43,332-340

`PackageFilterIterator` stores a `GlobWalkerIterator<'static>` that borrows the
same struct's `walker` field. The source comment states this is unsound if the
iterator moves after init. The type is not pinned and exposes safe methods.

Current main use appears to keep the value in one stack slot, so this is a P2
watchlist rather than a proven live bug. Fix with Pin<Box<Self>> or by combining
walker+iterator into an owning bun_glob type.
EOF
)"
```

### codex-p3-005 — package-manager tasks store `&'static mut NetworkTask`

```bash
br create \
  --priority 2 \
  --title "[unsafe-audit] package-manager resolve tasks store &'static mut NetworkTask across worker boundary" \
  --labels "unsafe-audit,codex-pass3,package-manager,threading" \
  --description "$(cat <<'EOF'
**Files:**
- src/install/PackageManagerTask.rs:24-30,633-653
- src/install/PackageManager/PackageManagerEnqueue.rs:352-382,1654-1687

The source comment says a `&'a mut NetworkTask` cannot soundly cross the
intrusive cross-thread queue and should likely become `*mut NetworkTask`.
Enqueue paths currently create `'static` reborrows from pool slots.

This needs a focused design patch: store a raw pointer or pool index, and
materialize short-lived references only at the call boundary that owns the pool
discipline.
EOF
)"
```

### codex-p3-006 — `CopyFile<'a>` carries unsound JSGlobalObject lifetime across threads

```bash
br create \
  --priority 2 \
  --title "[unsafe-audit] CopyFile<'a> stores &JSGlobalObject in a task that crosses worker threads" \
  --labels "unsafe-audit,codex-pass3,jsc,threading" \
  --description "$(cat <<'EOF'
**File:** src/runtime/webcore/blob/copy_file.rs:46-67

The source says `CopyFile<'a>` is box-allocated and crosses threads, and that
the `'a` lifetime on `global_this: &'a JSGlobalObject` is unsound in practice.

This is a concrete instance of the pass-3 cross-thread task-boundary problem.
Fix direction: raw pointer/backref plus explicit worker-inert safety proof, or
split worker state from JS completion state.
EOF
)"
```

## P3 — Cluster parent epics + per-PR beads

### Cluster C-001 — `NonNull::new_unchecked` → safe form

```bash
# Parent epic
PARENT_C001=$(br create \
  --priority 3 \
  --title "[unsafe-audit] cluster C-001: NonNull::new_unchecked → safe form (40 sites, 22+ firm refactorable)" \
  --labels "unsafe-audit,unsafe-audit-c001,refactor" \
  --description "$(cat <<'EOF'
Per audit/plans/C-001-nonnull-from-reference.md:
  - 9+ firm C-NULLABLE sites — NonNull::from(&T)
  - 13 C-CHECKED sites — NonNull::new(p).expect(invariant)
  - 17 (A) sites — bounded inside unsafe fn constructors; stylistic cleanup
Headline: 22+ firm safe rewrites after excluding/solving the `const fn`
StoreRef::from_static site flagged by Codex pass 2.
EOF
)" | awk '{print $NF}')

# PR-1 bead: C-NULLABLE rewrites (non-const sites only)
br create --priority 3 --blockedBy "$PARENT_C001" \
  --title "[C-001] PR-1: NonNull::from rewrites (non-const C-NULLABLE sites)" \
  --labels "unsafe-audit-c001,demo-pr" \
  --description "Sites listed in audit/plans/C-001 § Pattern P1, excluding S-000286 unless its const-fn issue is solved. Verify with cargo +nightly miri test on touched crates."

# PR-2 bead: C-CHECKED rewrites (13 sites)
br create --priority 3 --blockedBy "$PARENT_C001" \
  --title "[C-001] PR-2: NonNull::new(...).expect(...) rewrites (13 C-CHECKED sites)" \
  --labels "unsafe-audit-c001,demo-pr"

# PR-3 bead: (A) optional cleanup (17 sites, lower priority)
br create --priority 5 --blockedBy "$PARENT_C001" \
  --title "[C-001] PR-3: constructor cleanup (17 A sites, optional)" \
  --labels "unsafe-audit-c001"
```

### Cluster C-002 — `mem::transmute<int, enum>` → `strum::FromRepr`

```bash
PARENT_C002=$(br create \
  --priority 3 \
  --title "[unsafe-audit] cluster C-002: integer-to-enum transmutes (30 sites, 6 refactor)" \
  --labels "unsafe-audit,unsafe-audit-c002,refactor" \
  --description "Per audit/plans/C-002 plus Codex pass-2 correction. 3 C-SAFE sites refactor to checked strum::FromRepr conversions. 3 C-CALLER-TRUST sites become checked/unchecked constructor pairs. Latent-UB-001 is filed separately." | awk '{print $NF}')

br create --priority 3 --blockedBy "$PARENT_C002" \
  --title "[C-002] PR-3: PropertyIdTag, cares::Error, uv_handle_type → strum::FromRepr (3 sites)" \
  --labels "unsafe-audit-c002,demo-pr"

br create --priority 4 --blockedBy "$PARENT_C002" \
  --title "[C-002] PR-4: SystemErrno::from_raw checked variant exposed publicly" \
  --labels "unsafe-audit-c002"
```

### Cluster C-003 — Send/Sync impl refactor

```bash
PARENT_C003=$(br create \
  --priority 3 \
  --title "[unsafe-audit] cluster C-003: unsafe impl Send/Sync (157 manual + 188 other, 46 refactorable)" \
  --labels "unsafe-audit,unsafe-audit-c003,refactor" \
  --description "Per audit/plans/C-003 plus Codex pass-2 correction. 28 C-PROPAGATE (NonNull+PhantomData), 9 C-USE-ASSERTIONS (use Bun's no-dependency auto-trait proof or explicitly add assertion dependency), 3 C-REMOVE-IMPL, 6 C-CONSOLIDATE (SendPtr<T> shared). pre-existing-ub-002 filed separately." | awk '{print $NF}')

br create --priority 3 --blockedBy "$PARENT_C003" \
  --title "[C-003] PR-1: C-USE-ASSERTIONS (9 sites, zero-risk)" \
  --labels "unsafe-audit-c003,demo-pr" \
  --description "Replace 9 manual Send/Sync impls with compile-time auto-trait assertions. Use Bun's existing no-dependency trait trick unless maintainers explicitly accept static_assertions."

br create --priority 4 --blockedBy "$PARENT_C003" \
  --title "[C-003] PR-2: C-PROPAGATE NonNull+PhantomData refactor (28 sites)" \
  --labels "unsafe-audit-c003"

br create --priority 4 --blockedBy "$PARENT_C003" \
  --title "[C-003] PR-3: consolidate scattered SendPtr<T> newtypes into bun_ptr (6 sites)" \
  --labels "unsafe-audit-c003"

br create --priority 5 --blockedBy "$PARENT_C003" \
  --title "[C-003] PR-4: C-REMOVE-IMPL — drop impls on types that don't need to cross threads (3 sites)" \
  --labels "unsafe-audit-c003"
```

### Cluster A-001 — Zig-port `*mut Self` SAFETY hardening

```bash
PARENT_A001=$(br create \
  --priority 5 \
  --title "[unsafe-audit] cluster A-001: Zig-port *mut Self pattern SAFETY hardening (1,610 sites)" \
  --labels "unsafe-audit,unsafe-audit-a001,documentation,safety-comments" \
  --description "Per audit/plans/A-001. ~97% (A) STRICTLY_UNAVOIDABLE per Invariant I-001. 8 subclasses identified, each with a hardened SAFETY-comment template. ~3% (C-PURE-RUST) tail concentrated in bun_exe_format::pe.rs." | awk '{print $NF}')

br create --priority 4 --blockedBy "$PARENT_A001" \
  --title "[A-001] PR-1: pure-Rust subset refactor — bun_exe_format::pe.rs (~14 unsafe blocks)" \
  --labels "unsafe-audit-a001,refactor"

br create --priority 5 --blockedBy "$PARENT_A001" \
  --title "[A-001] PR-2: SAFETY-comment templates applied to impl_streaming_writer_parent! call sites" \
  --labels "unsafe-audit-a001,documentation"

br create --priority 5 --blockedBy "$PARENT_A001" \
  --title "[A-001 watchlist] miri harness for h2_frame_parser.rs:3429 *mut Stream aliasing" \
  --labels "unsafe-audit-a001,verification"

br create --priority 5 --blockedBy "$PARENT_A001" \
  --title "[A-001 watchlist] miri harness for WindowsNamedPipe.rs:1432 borrow=mut choice" \
  --labels "unsafe-audit-a001,verification"
```

### Cluster B-001/B-002 — `safe-only` Cargo feature

```bash
PARENT_B=$(br create \
  --priority 4 \
  --title "[unsafe-audit] clusters B-001/B-002: safe-only Cargo feature for perf-only unsafe" \
  --labels "unsafe-audit,unsafe-audit-b,cargo-feature" \
  --description "Per audit/plans/B-001-and-B-002-perf-only.md plus Codex pass-2 correction. ~17 B-candidate-hot sites need benchmark logs before being called proven; ~10 B-UNMEASURED treated as (C) candidates; 4 bun_jsc/generated.rs sites become unconditional unreachable!()." | awk '{print $NF}')

br create --priority 4 --blockedBy "$PARENT_B" \
  --title "[B] PR-1: workspace safe-only feature + bun_install + bun_semver demo (~7 sites)" \
  --labels "unsafe-audit-b,demo-pr"

br create --priority 4 --blockedBy "$PARENT_B" \
  --title "[B] PR-2: bun_jsc/generated.rs bindgen-drift safe-unreachable rewrite (4 sites)" \
  --labels "unsafe-audit-b"

br create --priority 5 --blockedBy "$PARENT_B" \
  --title "[B] PR-3+: roll safe-only to remaining (B) crates with measured perf delta" \
  --labels "unsafe-audit-b,bench-driven"
```

### Cluster A-002 — `bun_core::heap` round-trip verification

```bash
br create \
  --priority 5 \
  --title "[unsafe-audit] cluster A-002: verify into_raw/take/destroy pairing (204 sites)" \
  --labels "unsafe-audit,unsafe-audit-a002,verification" \
  --description "Per audit/synthesis/refactor-clusters.md cluster A-002. Verify every into_raw has matching take/destroy on every exit path including panic and async cancellation. This is a verification/hardening pass; no refactor expected."
```

### Cluster A-003 — `*_sys` SAFETY-comment hardening (per-crate)

```bash
br create --priority 5 --title "[A-003] harden SAFETY comments in bun_uws_sys (253 sites)" --labels "unsafe-audit-a003"
br create --priority 5 --title "[A-003] harden SAFETY comments in bun_libuv_sys (133 sites)" --labels "unsafe-audit-a003"
br create --priority 5 --title "[A-003] harden SAFETY comments in bun_mimalloc_sys (84 sites)" --labels "unsafe-audit-a003"
br create --priority 5 --title "[A-003] harden SAFETY comments in bun_libarchive_sys (~80 sites)" --labels "unsafe-audit-a003"
# ... per remaining *_sys crate ...
```

## Total bead count

| Group | Beads |
|-------|------:|
| Pre-existing-UB / high-priority watchlist | 3 |
| Cluster epics | 6 |
| Cluster implementation beads | ~20 |
| Per-crate hardening beads (A-003) | ~14 |
| **Total** | **~43** |

This is a workable bead graph for sequential or parallel remediation. The graph is intentionally partitioned by finding class so agents can take disjoint clusters without mixing source-level fixes, audit-artifact edits, and verification work.
