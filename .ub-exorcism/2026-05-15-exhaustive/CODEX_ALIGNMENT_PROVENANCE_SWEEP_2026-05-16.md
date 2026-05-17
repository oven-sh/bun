# Codex Alignment / Provenance Sweep — 2026-05-16

Purpose: revisit Phase-2 Bucket 3 after the safe-API sweep, focusing on raw-byte to typed-slice reinterpretation sites that were left as conditional or hardening-only.

## Promotion

### EXP-088 — `E::String::init_utf16` / `slice16` narrowed-provenance representation

Source:

- `src/ast/e.rs:1449-1459` (`E::String::init_utf16`)
- `src/ast/e.rs:1413-1424` (`E::String::slice16`)
- Propagated through callers such as `src/js_parser/lexer.rs:2751-2752`, `src/parsers/json_lexer.rs:575-581`, and `src/parsers/yaml.rs:1782-1785`.

Original Phase-2 framing said the UTF-16 reinterpret trio was conditional: upstream bytes were assumed to originate from `&[u16]`, so the main risk was a future caller passing arbitrary bytes.

That was too weak. The source-shaped constructor itself narrows the byte-slice range:

```rust
let bytes = &bytemuck::cast_slice::<u16, u8>(data)[..data.len()];
```

For `N` UTF-16 code units, the full backing range is `2 * N` bytes, but the stored `Str` tag covers only `N` bytes. Later `slice16()` treats `data.len()` as a u16 element count and retags `2 * N` bytes:

```rust
slice::from_raw_parts(self.data.as_ptr().cast::<u16>(), self.data.len())
```

The reproducer in `experiments/EXP-088` mirrors this exact shape. Miri reports:

```text
trying to retag ... at alloc108[0x2] ... tag does not exist
help: <287> was created by a SharedReadOnly retag at offsets [0x0..0x2]
```

Verdict: `CONFIRMED_UB`. This is a representation bug, not just missing documentation.

## Fix Shape

Do not keep the "lying byte length" encoding. One of these should land:

- Store a typed UTF-16 representation: `Utf16Bytes { ptr: NonNull<u16>, len_u16 }`.
- Store the full byte slice length (`2 * len_u16`) plus a separate UTF-16 element count.
- Use an enum representation: `EStringData::Utf8(Str)` / `EStringData::Utf16(StoreSlice<u16>)`.

The smallest source-compatible patch is probably full-byte-length storage plus a separate u16 length field; the maintainable patch is a typed UTF-16 representation.

## Artifact Impact

- Added `EXP-088` to `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`.
- Added `experiments/EXP-088` and `phase5_experiment_results/EXP-088.log`.
- Promoted Phase-2 Bucket-3 `EXP-N3` from conditional/hardening to confirmed UB.
- Updated `phase4_unified_findings.md`, `phase2_findings_03_alignment.md`,
  `phase8_remediation_plan.md`, `FINAL_UB_REPORT.md`, `UB_RUNBOOK.md`, and
  convergence round 51 to 84 registry entries / 54 `CONFIRMED_UB` at the time
  of this sweep. Later follow-ups continued through EXP-111 and superseded the
  interim 94-entry / 60-confirmed checkpoint; use `FINAL_UB_REPORT.md` for the
  current pinned-base count.
