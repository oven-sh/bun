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

The tool linear-sweeps every byte in `.text`. There's no general way to do
better for x86: toolchains don't emit "this byte is data" markers the way
ARM EABI's `$d` mapping symbols do, and code/data separation in x86 binaries
is undecidable in general
([Schwarz & Debray 2002](https://www2.cs.arizona.edu/~debray/Publications/disasm.pdf)).

MSVC inlines jump tables and small `static const` arrays into `.text` right
after the function that uses them (LLVM puts them in `.rodata`, so ELF builds
are typically clean). When those bytes form a valid instruction encoding,
the decoder reports it.

**Filtered automatically:** 3DNow!, SMM, Cyrix, VIA Padlock — ISA extensions
no toolchain targeting x86-64 emits in any configuration. Their two-byte
`0f xx` encodings tend to surface when a lookup table uses `0x0f` as a
sentinel value.

**Not filtered (very rare):** a table whose bytes form a valid
VEX/EVEX-prefixed encoding. Looks like a real AVX hit. Triage the same way:
disassemble around the address; if preceded by `ret` + small-int byte soup
instead of stack-frame setup, it's a table. Allowlist the symbol.

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

**aarch64:**

- **PACIASP / AUTIASP / BTI** — HINT-space; architecturally NOP on older CPUs.
- **`$d`-marked data** — literal pools and inline strings in `.text` are
  skipped via ARM EABI mapping symbols.

## Symbol attribution

| Binary | Primary source                                                  | Fallback                                     |
| ------ | --------------------------------------------------------------- | -------------------------------------------- |
| ELF    | `.symtab`                                                       | `.dynsym`                                    |
| PE     | PDB DBI module stream (`S_*PROC32`, has real sizes) → `S_PUB32` | PDB section contributions → `<lib:NAME.lib>` |

The Windows fallback handles code with no per-function PDB record (stripped
CRT objects, anonymized staticlib helpers). Section contributions are the
linker-map data in structured form — they say which `.obj`/`.lib` every byte
came from. Attribution is by library basename, which doesn't move when
unrelated code shifts the link layout.

PDB coverage for the same code can vary across linker versions — a function
that gets an `S_LPROC32` record on one toolchain may fall through to `<lib:>`
on another. If a symbol flips between a mangled name and `<lib:NAME.lib>`
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
