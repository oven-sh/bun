# Miri-Confirmed UB Summary — Pass 4 Verification

**Standard of evidence:** every entry listed here has a concrete `cargo +nightly miri run` trace. Four traces have dedicated sibling detail files in this directory; PUB-INSTALL-3 is currently captured in this summary only and should be split into its own detail file before using the miri corpus as a standalone public artifact. These claims are no longer "static-analysis hypothesis" — they are runtime-detected UB with miri's word for the minimized witness pattern.

## The 5 miri-backed UB witnesses

| # | Bug | Source | Miri error (verbatim) | Detail file |
|---|-----|--------|----------------------|-------------|
| 1 | `linear_fifo::assume_init_slice<T>` for niche T | `src/collections/linear_fifo.rs:67-71` | `reading memory at alloc119[0x0..0x4], but memory is uninitialized` | [miri-confirmed-linear-fifo-niche-ub.md](miri-confirmed-linear-fifo-niche-ub.md) |
| 2 | `linux_errno::impl GetErrno for usize` transmute | `src/errno/linux_errno.rs:175-188` | `constructing invalid value of type SystemErrno: at .<enum-tag>, encountered 0x0086, but expected a valid enum tag` | [miri-confirmed-linux-errno-transmute.md](miri-confirmed-linux-errno-transmute.md) |
| 3 | PUB-INSTALL-1 `Meta::has_install_script` byte | `src/install/lockfile/Package/Meta.rs:38-46` | `enum value has invalid tag: 0x2a` | [miri-confirmed-pub-install-1.md](miri-confirmed-pub-install-1.md) |
| 4 | UB-RT-001 `Vec<u8>→Vec<u16>` allocator-layout | `src/runtime/webcore/encoding.rs:303-310` | `incorrect layout on deallocation: alloc194 has size 6 and alignment 1, but gave size 6 and alignment 2` | [miri-confirmed-encoding-vec-layout.md](miri-confirmed-encoding-vec-layout.md) |
| 5 | PUB-INSTALL-3 `yarn.rs` uninit Dependency slice | `src/install/yarn.rs:918-925` | `reading memory at alloc206[0x0..0x1], but memory is uninitialized` | (this file) |

## What this verification proves

For each entry:
1. The audit's static-analysis claim is **independently corroborated by miri**.
2. The exact arithmetic / Layout shape Bun's source uses produces the UB.
3. The bug class (niche violation, allocator-layout mismatch, uninit-read) is one of Rust's well-defined UB axes — not a stylistic concern.

## What this verification does NOT prove

- That all of these bugs trigger in production today. PUB-INSTALL-1, PUB-INSTALL-3, and UB-RT-001 have JS/supply-chain reachability evidence; exploitability beyond reaching UB is not claimed here. Linear_fifo and linux_errno have no known live callers today — they're latent bugs that would trigger if a caller follows the source's documented calling convention with the reproduced inputs.
- That mimalloc's permissiveness wouldn't paper over UB-RT-001 in production. miri's `incorrect layout on deallocation` is the abstract `GlobalAlloc` contract; mimalloc-specific behavior is more permissive in practice. The bug is still UB by Rust's abstract machine.
- That the bundler B-1..B-5 cluster (parallel `&mut LinkerContext` aliasing) reproduces under miri — that requires actual multi-thread reasoning and the right scheduling, both of which miri can model but the reproducer would need a Loom-style integration. Pass-5 work.

## Remaining audit T1 findings without a miri trace yet

| Finding | Status |
|---------|--------|
| StoreSlice<T> Send/Sync unbounded | Type-level check; rustc compile-fail test in audit/tests/storeslice_send_compilefail.rs verifies the pre-fix / post-fix transition |
| Bundler B-1..B-5 parallel `&mut` aliasing | Stacked Borrows violation; reproducing requires Loom or a hand-scheduled miri test |
| picohttp H9 NUL-write through shared | Same shape as U2 cluster; reproducing follows the U2 pattern |
| 6 ptr_intrinsic UB-candidates (Unaligned cast, etc.) | Each can be miri-reproduced individually; pass 5 work |
| 8 U2 dealloc-through-SharedReadOnly | The pattern is the same; one reproducer covers all 8 |

For the audit's marketing claim: **five concrete miri traces is strong evidence that the listed UB patterns are real**. A pass-5 audit can add more where a finding is scheduler-dependent or needs integration wiring.

## Reproducer pattern

Each miri reproducer follows the same minimal-cargo-project pattern:

```bash
mkdir /tmp/miri-repro-N/src
cat > /tmp/miri-repro-N/Cargo.toml <<EOF
[package]
name = "miri_repro_N"
version = "0.0.1"
edition = "2021"
[[bin]]
name = "repro"
path = "src/main.rs"
EOF
# (Adversarial Rust source in src/main.rs)
cd /tmp/miri-repro-N
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run
```

The reproducers are intentionally minimal — they mirror Bun's source patterns without depending on Bun's crate tree. This makes them runnable by any reviewer in seconds.
