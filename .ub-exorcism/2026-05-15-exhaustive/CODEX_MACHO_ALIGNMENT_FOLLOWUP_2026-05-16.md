# Codex Mach-O Alignment Follow-Up — 2026-05-16

Scope: targeted sibling check after promoting the PE object-file alignment
cluster to EXP-093.

## Trigger

The PE follow-up established that `bun_exe_format::pe` was materialising typed
references from byte-backed object-file storage. `bun_exe_format::macho` has a
similar domain and, importantly, its own `macho_types.rs` module header says
the on-disk POD structs should be read/written through unaligned
`ptr::{read,write}_unaligned`, exactly like Zig `*align(1) const T` casts.

That made the Mach-O sibling worth re-reading with the same standard.

## Source Shape

The good pattern exists and should be preserved:

- `src/sys/lib.rs:5815-5824` implements `LoadCommand::cast<T>()` as
  `ptr::read_unaligned(self.data.ptr.cast::<T>())` and returns an owned `T`.
- `src/exe_format/macho.rs:163-170` writes a `segment_command_64` back to the
  load-command region via `ptr::write_unaligned`, with a comment explicitly
  saying the region is unaligned and mirrors Zig `*align(1)`.

The bug is the inconsistent mutation tail:

- `src/exe_format/macho.rs:121-130` constructs
  `&mut [macho::section_64]` over `self.data.as_mut_ptr().add(...).cast()`.
- `src/exe_format/macho.rs:366` materialises
  `&mut macho::symtab_command`.
- `src/exe_format/macho.rs:371` materialises
  `&mut macho::dysymtab_command`.
- `src/exe_format/macho.rs:392` materialises
  `&mut macho::linkedit_data_command`.
- `src/exe_format/macho.rs:403` materialises
  `&mut macho::dyld_info_command`.

Those `&mut T` / `&mut [T]` values require alignment for `T`. The backing
storage is `Vec<u8>` / `&[u8]` object-file bytes, and the current API does not
prove alignment of the allocation base plus every command/section offset before
forming references.

## Experiment

Added `experiments/EXP-095`, a minimal Miri witness mirroring the production
shape:

```text
Vec<u8> command bytes
  -> write a SymtabCommand with ptr::write_unaligned
  -> read the command header with ptr::read_unaligned (good iterator pattern)
  -> form &mut *cmd_ptr.cast::<SymtabCommand>() (macho.rs:366 shape)
```

Invocation:

```bash
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-095
MIRIFLAGS="-Zmiri-symbolic-alignment-check" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-095.log
```

Miri signal:

```text
constructing invalid value of type &mut SymtabCommand:
encountered an unaligned reference (required 4 byte alignment but found 1)
```

## Artifact Changes

- Added registry entry `EXP-095` with verdict `CONFIRMED_UB`.
- Added `experiments/EXP-095` and `phase5_experiment_results/EXP-095.log`.
- Added Phase-4 row `F-004d`.
- Added Phase-8 remediation block `R-EXP-095`.
- Updated `phase1_inventory_R.md`, `phase2_findings_03_alignment.md`,
  `phase4_unified_findings.md`, `phase8_remediation_plan.md`,
  `UB_RUNBOOK.md`, and `FINAL_UB_REPORT.md`.
- Live totals become 91 registry experiments / 60 `CONFIRMED_UB`.

## Remediation

Preferred fix: mutate Mach-O load commands by value. Read each command with
`ptr::read_unaligned`, update the owned local, then write it back with
`ptr::write_unaligned`. For section tables, iterate element-by-element with
unaligned reads/writes or copy into an aligned temporary vector before mutation.

Do not paper over this by saying normal Mach-O command offsets are aligned.
That may reduce exploitability for ordinary compiler-produced files, but it
does not prove Rust reference validity for a safe API over byte-backed object
data, and it does not prove `Vec<u8>` allocation alignment.
