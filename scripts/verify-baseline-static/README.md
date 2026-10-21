# verify-baseline-static

Static ISA verifier for Bun baseline builds. Disassembles every instruction in
`.text` and flags anything requiring CPU features beyond the baseline target.

| Target  | Baseline                           | Flags                                                                        |
| ------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| x86-64  | Nehalem (`-march=nehalem`)         | AVX, AVX2, AVX-512, BMI1/2, FMA, AES-NI, PCLMULQDQ, ADX, SHA-NI, RDRAND, ... |
| aarch64 | armv8-a+crc (`-march=armv8-a+crc`) | LSE atomics, SVE, DotProd, RCPC, JSCVT, RDM, non-hint PAC                    |

Architecture and format (ELF/PE) are auto-detected from the binary header.

Complements the emulator-based check in `scripts/verify-baseline.ts`: the
emulator only catches instructions the test suite _executes_. This catches
everything the compiler _emitted_.

## Usage

```sh
cargo build --release --manifest-path scripts/verify-baseline-static/Cargo.toml

./scripts/verify-baseline-static/target/release/verify-baseline-static \
  --binary path/to/bun-linux-x64-baseline/bun-profile \
  --allowlist scripts/verify-baseline-static/allowlist-x64.txt
```

`--allowlist` can be repeated; entries merge (feature ceilings union,
blanket-pass wins). Useful for layering an extra allowlist on top of the
base one without editing it.

`--min-data-ranges <n>` makes a scan that leaves out fewer than `n` data
ranges a tool error. `scripts/verify-baseline.ts` passes `1` for Windows x64,
where the scan depends on the PDB's jump-table marks (see "Data-in-`.text`
false positives").

Exit `0` = clean, `1` = violations, `2` = tool error.

Use the `-profile` artifact. The stripped release binary has no `.symtab`
(ELF) and no companion `.pdb` (PE) — every violation becomes `<no-symbol@addr>`
and nothing in the allowlist matches. Windows auto-discovers `<binary>.pdb`
if present, or pass `--pdb` explicitly.

## When it fails

A new symbol showed up with post-baseline instructions. Two possibilities:

1. **It's runtime-dispatched** (CPUID / HWCAP-gated). Find the gate in the
   caller, add the symbol to the allowlist with a comment pointing at it.
   Group with related symbols.

2. **It's not gated.** That's a real bug — a `-march` flag leaked into a
   subbuild and the function will SIGILL on baseline hardware. Fix the
   compile flags for that translation unit.

If you're not sure which: run the binary under `qemu-x86_64 -cpu Nehalem`
(or `qemu-aarch64 -cpu cortex-a53`) and hit that code path. SIGILL = bug.

### Data-in-`.text` false positives

The tool linear-sweeps every byte in `.text`, restarting the decoder at every
symbol start (an instruction that would straddle one is discarded), so data at
the end of a function — JSC's LLInt puts a 4-byte opcode id in front of every
`llint_op_*` label — cannot desynchronise the decode of the functions after
it. Within one symbol, the sweep needs the toolchain to say which bytes are
data: code/data separation in x86 binaries is undecidable in general
([Schwarz & Debray 2002](https://www2.cs.arizona.edu/~debray/Publications/disasm.pdf)).

MSVC stores the jump table of a `switch` in `.text`, after the last
instruction of the function that uses it (LLVM puts jump tables in `.rodata`,
so ELF builds are typically clean). Each entry is the image-relative address
of a case label. The bytes change with link layout, and at some layouts they
form a valid instruction encoding.

**Skipped with the PDB:** the jump tables that MSVC marks. cl writes an
unnamed, untyped `S_LDATA32` record at the first byte of each table, inside
the scope of the procedure. The scanner reads those records
(`msvc_table_ranges` in `src/main.rs`). A block runs from a record to the next
record of the procedure, or to the procedure's end. The sweep leaves a block
out only when every 4-byte word in it is the address of code of that
procedure. Stderr counts the marks and the blocks left out (`N data ranges`).
Any other block is decoded like code: the byte index table of a two-level
switch (small integers that do not change with link layout), or a record that
is not a table.

**Not marked:** JSC's LLInt opcode ids inside `llint_entry` on Windows (the PDB
has one symbol for the whole interpreter and no record for the ids), constants
in hand-written asm, objects linked without CodeView records, and every table
of a PE scanned without its PDB.

**Filtered automatically:** 3DNow!, SMM, Cyrix, VIA Padlock, RTM/TSX — ISA
extensions no toolchain targeting x86-64 emits without explicit intrinsics.
Their encodings (`0f xx` for the defunct extensions, `C7/C6 F8` for
XBEGIN/XABORT) surface when the bytes of unmarked data happen to line up.

**Not filtered (very rare):** unmarked data whose bytes form a valid
VEX/EVEX-prefixed encoding. Looks like a real AVX hit. Triage the same way:
disassemble around the address; if preceded by `ret` + small-int byte soup
instead of stack-frame setup, it's data. Allowlist the symbol.

## What's deliberately ignored

**x64:**

- **ENDBR64 / CET_IBT** — NOP-compatible on pre-CET CPUs by design.
- **TZCNT** — LLVM preloads the destination with operand-width so the
  REP-BSF fallback on pre-BMI1 CPUs gives identical results. (LZCNT is
  **not** ignored: `BSR` and `LZCNT` produce different results, and LLVM
  never emits LZCNT for `-march=nehalem`.)
- **XGETBV** — every AVX-dispatch path calls this, always after
  `if (CPUID.OSXSAVE)`. A stray one would SIGILL at startup; the emulator
  test catches that trivially.
- **PDB-marked jump tables** (Windows) — MSVC's switch tables in `.text`, see
  "Data-in-`.text` false positives" above.

**aarch64:**

- **PACIASP / AUTIASP / BTI** — HINT-space; architecturally NOP on older CPUs.
- **`$d`-marked data** — literal pools and inline strings in `.text` are
  skipped via ARM EABI mapping symbols.

## Symbol attribution

| Binary | Primary source                                                  | Fallback                                                       |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------------- |
| ELF    | `.symtab`                                                       | `.dynsym`                                                      |
| PE     | PDB DBI module stream (`S_*PROC32`, has real sizes) → `S_PUB32` | PDB section contributions → `<lib:NAME.lib>`, `<lib:NAME.obj>` |

The Windows fallback handles code with no per-function PDB record (stripped
CRT objects, anonymized staticlib helpers, an asm file's leading local
routine). Section contributions are the linker-map data in structured form —
they say which `.obj`/`.lib` every byte came from. Attribution is by
library/object basename, which doesn't move when unrelated code shifts the
link layout; a zero-size `S_PUB32`'s synthesized range is also cut at its own
contribution so it cannot absorb the next object's unnamed code.

PDB coverage for the same code can vary across linker versions — a function
that gets an `S_LPROC32` record on one toolchain may fall through to `<lib:>`
on another. If a symbol flips between a mangled name and `<lib:NAME.lib>` / `<lib:NAME.obj>`
across CI runs, allowlist both forms.

Rust v0 mangled names carry a crate-hash (`Cs[base62]_`) that changes across
target triples and toolchain versions. The allowlist uses `<rust-hash>` as a
placeholder; the tool canonicalizes both sides before comparing.

## Allowlist format

```
# comment
symbol_name                  # blanket pass — any feature allowed
symbol_name  [AVX, AVX2]     # feature ceiling — only these allowed
```

A feature outside the brackets is a violation even for an allowlisted symbol.
Widening the bracket is the explicit checkpoint for "did the gate get updated
when the dependency did?"

| File                        | Covers                                                        |
| --------------------------- | ------------------------------------------------------------- |
| `allowlist-x64.txt`         | `linux-x64-baseline`, `linux-x64-musl-baseline`               |
| `allowlist-x64-windows.txt` | `windows-x64-baseline` (separate: MSVC mangling, CRT symbols) |
| `allowlist-aarch64.txt`     | `linux-aarch64`, `linux-aarch64-musl`                         |

One allowlist covers both glibc and musl because the dispatch surface is
architecture-specific, not libc-specific. Symbols that LTO inlined away on
one libc show as STALE on the other — informational, not an error.

## Tests

```sh
cargo test --manifest-path scripts/verify-baseline-static/Cargo.toml
```

- `src/tests.rs`: the x64 sweep and the jump-table rule on byte fixtures.
- `src/aarch64.rs`: the aarch64 encoding masks.
- `tests/pdb_marks.rs`: the built scanner on `tests/fixtures/switch-table.dll`
  and its PDB. `tests/fixtures/switch-table.s` is their source and holds the
  commands that rebuild them.
