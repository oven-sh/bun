# Codex Type-Punning Layout Sweep — 2026-05-16

Scope: Bucket 6 (`transmute` / union) follow-up after the round-52 ast-grep
sweep. This pass focused on claims that are easy to overstate: layout
transmutes that are described as "sound" but whose source-side proof may be
weaker than the prose.

## 1. `rustix::fs::Stat -> libc::stat`

**Site:** `src/sys/linux_syscall.rs:198-209`

**Current artifact status:** `phase2_findings_06_type_punning.md` classified
this as sound on `x86_64` / `aarch64`.

**Fresh-eyes concern:** the source code's `const` assertion checks only
`size_of` and `align_of`. Size/align equality alone does not prove field
layout equality, so the audit needed either a correction or a stronger witness.

**Result:** no new EXP. The transmute is sound on the two cfg-enabled Linux
targets, but the proof is now explicit:

- `rustix 0.38.44` exposes `rustix::fs::Stat` as
  `linux_raw_sys::general::stat` on 64-bit non-mips Linux.
- `libc 0.2.186` represents private padding as
  `Padding<MaybeUninit<T>>`, so padding bytes do not impose initialized-value
  requirements.
- A standalone compile-time offset witness was added under
  `experiments/CODEX-stat-layout/`.

Commands run:

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/CODEX-stat-layout
cargo check --target x86_64-unknown-linux-gnu
cargo check --target aarch64-unknown-linux-gnu
cargo run
```

The `cargo check` builds include `const` assertions for:

- `size_of::<rustix::fs::Stat>() == size_of::<libc::stat>()`
- `align_of::<rustix::fs::Stat>() == align_of::<libc::stat>()`
- every public data-field offset:
  `st_dev`, `st_ino`, `st_nlink`, `st_mode`, `st_uid`, `st_gid`,
  `st_rdev`, `st_size`, `st_blksize`, `st_blocks`, `st_atime`,
  `st_atime_nsec`, `st_mtime`, `st_mtime_nsec`, `st_ctime`,
  `st_ctime_nsec`

Raw outputs:

- `phase5_experiment_results/CODEX-stat-layout-x86_64-check.log`
- `phase5_experiment_results/CODEX-stat-layout-aarch64-check.log`
- `phase5_experiment_results/CODEX-stat-layout.log`

Runtime x86_64 output:

```text
size  rustix=144 libc=144
align rustix=8 libc=8
st_dev           rustix=0   libc=0   OK
st_ino           rustix=8   libc=8   OK
st_nlink         rustix=16  libc=16  OK
st_mode          rustix=24  libc=24  OK
st_uid           rustix=28  libc=28  OK
st_gid           rustix=32  libc=32  OK
st_rdev          rustix=40  libc=40  OK
st_size          rustix=48  libc=48  OK
st_blksize       rustix=56  libc=56  OK
st_blocks        rustix=64  libc=64  OK
st_atime         rustix=72  libc=72  OK
st_atime_nsec    rustix=80  libc=80  OK
st_mtime         rustix=88  libc=88  OK
st_mtime_nsec    rustix=96  libc=96  OK
st_ctime         rustix=104 libc=104 OK
st_ctime_nsec    rustix=112 libc=112 OK
```

**Artifact correction:** keep the verdict as sound, but describe it as
"size/align asserted in source; field-offset verified by Codex witness" rather
than implying the source's existing const assert alone proves full layout.

**Remediation note:** optional hardening only. Bun could inline the public-field
offset assertions into `stat_to_libc` if maintainers want future crate-version
drift to fail at the source site instead of only in this audit witness.

## 2. No count changes

This sweep did not promote a new registry entry and does not change current
totals:

- Registry entries: 85
- `CONFIRMED_UB`: 55
- `OPEN`: 0
- `NEEDS_REFINEMENT`: 0

