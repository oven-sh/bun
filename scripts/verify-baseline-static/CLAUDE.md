# verify-baseline-static — triage guide

Static ISA scanner. Disassembles every instruction in `.text` of a baseline
Bun binary and flags anything the baseline CPU can't decode. Catches `-march`
leaks at compile time, before they SIGILL on a user's machine.

This file is for triaging CI failures. For architecture details see
`README.md` and inline comments in `src/main.rs` / `src/aarch64.rs`.

## This is a best-effort check, not a proof

A PASS here does **not** guarantee the binary is baseline-safe, and a FAIL
does not guarantee a real bug. Treat it as a sensitive smoke detector, not an
oracle. The emulator phase (`scripts/verify-baseline.ts`) is the complementary
check — together they catch most things; neither alone is bulletproof.

**Out of scope entirely (tool will never find these):**

- **JIT-emitted code.** JSC compiles JS/WASM to machine code at runtime; none
  of it exists in `.text` at scan time. If the JIT backend emits post-
  baseline instructions on a baseline CPU, this tool is blind to it. The
  emulator's `--jit-stress` path covers this.
- **Dynamically loaded code.** N-API addons, FFI callees, dlopen'd shared
  libs. Scanner only reads the `bun-profile` binary.
- **Gate correctness.** The tool does not verify that a CPUID gate actually
  checks the right bits. It trusts the allowlist. Feature ceilings catch the
  "code grew new features, gate wasn't updated" case, but a gate that was
  wrong from the start (checks AVX, uses AVX2) passes silently if the
  ceiling says `[AVX, AVX2]`.

**In scope but may miss:**

- x64 linear-sweep may desync on data-in-`.text` and skip real instructions
  that follow. Variable-length x86 encoding makes perfect code/data
  separation undecidable (`README.md:53-59`). aarch64 is more reliable
  (fixed-width words, `$d` mapping symbols mark data), but a missing mapping
  symbol can still hide a hit.
- Instructions deliberately ignored (TZCNT/XGETBV on x64, hint-space PAC/BTI
  on aarch64) could theoretically be misused; we assume the compiler's idiom
  is the only one.

**Can report false violations:**

- Data bytes in `.text` that happen to form a valid post-baseline encoding.
  Rare on ELF (LLVM puts tables in `.rodata`), common on Windows PE (MSVC
  inlines jump tables). See `README.md:61-74`.

When in doubt, the emulator is ground truth: `qemu -cpu Nehalem` and hit the
code path. SIGILL = real bug. No SIGILL = either gated or a data-in-text
false positive.

## Which builds run this

`.buildkite/ci.mjs:592` — `needsBaselineVerification()`:

| Target                                          | Allowlist file              |
| ----------------------------------------------- | --------------------------- |
| `linux-x64-baseline`, `linux-x64-musl-baseline` | `allowlist-x64.txt`         |
| `windows-x64-baseline`                          | `allowlist-x64-windows.txt` |
| `linux-aarch64`, `linux-aarch64-musl`           | `allowlist-aarch64.txt`     |

x64 baseline = Nehalem (`-march=nehalem`, `cmake/CompilerFlags.cmake:33`).
aarch64 baseline = `armv8-a+crc` (`cmake/CompilerFlags.cmake:27-29`). aarch64
has no separate "baseline" build — the regular build _is_ the baseline.

## Reproduce a CI failure locally

The scanner runs on the _CI-built_ `-profile` artifact. You can't reproduce by
building locally unless you build with the exact baseline toolchain. Download
the artifact instead.

1. Get `<triplet>-profile.zip` from the failing build's `build-bun` step
   (Artifacts tab in Buildkite). Triplets look like `bun-linux-x64-baseline`,
   `bun-linux-aarch64-musl`, `bun-windows-x64-baseline`.

2. Build and run the scanner (host arch is irrelevant — the scanner reads the
   binary's headers, it doesn't execute it):

   ```sh
   cargo build --release --manifest-path scripts/verify-baseline-static/Cargo.toml

   # Linux x64 baseline
   ./scripts/verify-baseline-static/target/release/verify-baseline-static \
     --binary bun-linux-x64-baseline-profile/bun-profile \
     --allowlist scripts/verify-baseline-static/allowlist-x64.txt

   # Linux aarch64
   ./scripts/verify-baseline-static/target/release/verify-baseline-static \
     --binary bun-linux-aarch64-profile/bun-profile \
     --allowlist scripts/verify-baseline-static/allowlist-aarch64.txt

   # Windows x64 baseline (PDB auto-discovered at <binary>.pdb)
   ./scripts/verify-baseline-static/target/release/verify-baseline-static \
     --binary bun-windows-x64-baseline-profile/bun-profile.exe \
     --allowlist scripts/verify-baseline-static/allowlist-x64-windows.txt
   ```

**Never scan the stripped release binary.** It has no `.symtab` (ELF) / no
`.pdb` (PE), so every hit becomes `<no-symbol@addr>` and nothing matches the
allowlist.

## Reading the output

```
VIOLATIONS (would SIGILL on Nehalem):

  _ZN7simdutf7haswell14implementation17some_new_functionEPKcm  [AVX, AVX2]  (42 insns)
    0x0000a1b2c3  Vpbroadcastb  (AVX2)
    0x0000a1b2d7  Vpshufb  (AVX)
    0x0000a1b2ee  Vpcmpeqb  (AVX)
    ... 39 more

ALLOWLISTED (suppressed, runtime-dispatched):
  ...
  -- 550 symbols, 18234 instructions total

STALE ALLOWLIST ENTRIES (no matching symbol found — remove these?):
  _ZN7simdutf7haswell14implementation13old_gone_funcEPKcm

SUMMARY:
  violations:  1 symbols, 42 instructions
  allowlisted: 550 symbols
  stale allowlist entries: 1
  FAIL
```

- Violation line format: `symbol  [FEAT, ...]  (N insns)`. Copy the symbol
  name exactly when allowlisting — it's compared post-canonicalization.
- Feature names are iced-x86's `CpuidFeature` Debug names (x64) or the strings
  in `src/aarch64.rs:44-54` (aarch64). They must match the allowlist brackets
  character-for-character.
- `STALE` entries are informational, not an error. One allowlist covers both
  glibc and musl; a symbol LTO'd away on one libc shows STALE on the other.

## Triage: is this an allowlist entry or a real bug?

The tool found post-baseline instructions in some symbol. Two possibilities:

**A. Runtime-dispatched.** The symbol only runs after a CPUID/HWCAP gate
decides the CPU supports it. This is fine — allowlist it.

**B. Not gated.** A `-march` flag leaked into a translation unit that's always
executed. Real bug, will SIGILL on baseline hardware. Fix the compile flags.

### Deciding which

**Identify the dependency.** Demangle the symbol (`c++filt`, or recognize the
prefix: `_ZN7simdutf` = simdutf, `_ZN3bun` + `N_AVX2`/`N_SVE` = Bun's Highway
code, `_RNv` + `memchr` = Rust memchr, etc). Search the allowlist for that
dependency — if neighbors are there under an existing `# Gate: ...` header,
this is almost certainly (A).

**Find the gate.** Grep for the symbol name (unmangled) in the dependency's
source. Trace up to the caller — there should be a CPUID check, a dispatcher
table, an HWCAP test. Known patterns:

| Dependency                            | Gate                                                        | Where                                      |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| simdutf                               | `set_best()` — CPUID first call, cached atomic ptr          | `vendor/` or WebKit's bundled copy         |
| Highway (Bun)                         | `HWY_DYNAMIC_DISPATCH` → `hwy::SupportedTargets()`          | `src/bun.js/bindings/highway_strings.cpp`  |
| BoringSSL                             | `OPENSSL_ia32cap_P` global, set at init                     | `vendor/boringssl/crypto/cpu_intel.c`      |
| zstd                                  | `ZSTD_cpuid()`                                              | `vendor/zstd/lib/common/cpu.h`             |
| libdeflate                            | `libdeflate_init_x86_cpu_features()` / `HWCAP_ASIMDDP`      | `vendor/libdeflate/lib/x86/cpu_features.c` |
| Rust `memchr`                         | `is_x86_feature_detected!()`                                | (via lolhtml dep)                          |
| compiler-rt outline-atomics (aarch64) | `__aarch64_have_lse_atomics` (= `AT_HWCAP & HWCAP_ATOMICS`) | compiler-rt builtin                        |

**If no gate exists:** (B). Usually a subbuild that ignored
`ENABLE_BASELINE` and picked up host `-march=native`. Fix the
`cmake/targets/Build*.cmake` for that dep. Confirm with the emulator (the
ground-truth check):

```sh
qemu-x86_64 -cpu Nehalem ./bun-profile <code path that hits it>   # x64 → SIGILL = bug
qemu-aarch64 -cpu cortex-a53 ./bun-profile <code path>             # aarch64
```

### Data-in-`.text` false positives (x64, mostly Windows)

Linear-sweep decode means data bytes in `.text` can happen to form a valid
instruction encoding. LLVM puts tables in `.rodata` so ELF builds are usually
clean; MSVC inlines jump tables and `static const` arrays into `.text`.

Signs of a false positive:

- Symbol is a lookup table or a function you _know_ contains no SIMD.
- Reported instruction count is tiny (1–3) inside an otherwise-non-SIMD symbol.
- `objdump -d` around the reported address shows `ret` then byte soup — no
  stack frame setup, no control flow leading to it.

If confirmed: allowlist the symbol. Note the reason in the group comment.

## Adding an allowlist entry

Append the symbol to the appropriate file. Group with its neighbors under the
existing `# Gate: ...` header; if no existing group matches, add one:

```
# ----------------------------------------------------------------------------
# <dependency> <variant>. Gate: <what checks CPUID/HWCAP>.
# (N symbols)
# ----------------------------------------------------------------------------
symbol_name_exactly_as_the_tool_printed_it  [FEAT1, FEAT2]
```

**Always use a feature ceiling** (`[...]`). A blanket pass (no brackets)
defeats the "did the gate get updated when the dep grew AVX-512?" check
(`src/main.rs:616-621`). List exactly the features the tool reported; that's
what the gate currently checks.

**x64 feature names** (iced-x86 Debug strings — must match exactly):
`AVX`, `AVX2`, `FMA`, `FMA4`, `BMI1`, `BMI2`, `MOVBE`, `ADX`, `RDRAND`,
`AES`, `PCLMULQDQ`, `VAES`, `VPCLMULQDQ`, `SHA`, `AVX512F`, `AVX512BW`,
`AVX512DQ`, `AVX512VL`, `AVX512_VBMI`, `AVX512_VBMI2`, `AVX512_VNNI`,
`AVX512_VPOPCNTDQ`, `AVX512_FP16`, `AVX_VNNI`, …

**aarch64 feature names:** `LSE`, `SVE`, `RCPC`, `DotProd`, `JSCVT`, `RDM`,
`PAC(non-hint)`.

### Special symbol forms

**Rust v0 mangling — `<rust-hash>`.** Rust symbols contain a crate-hash
(`Cs[base62]_`) that changes across target triples and toolchains. The tool
canonicalizes both sides (`src/main.rs:196-227`), so allowlist entries should
use `<rust-hash>` in place of the hash:

```
# Tool reports:
  _RNvMNtNtNtNtCs5QMN7YRSXc3_6memchr4arch6x86_644avx26memchrNtB2_3One13find_raw_avx2  [AVX, AVX2]
# Allowlist as:
  _RNvMNtNtNtNt<rust-hash>6memchr4arch6x86_644avx26memchrNtB2_3One13find_raw_avx2  [AVX, AVX2]
```

Either form works (the tool canonicalizes both before comparing), but
`<rust-hash>` survives toolchain bumps.

**Windows `<lib:NAME.lib>`.** When PDB has no per-function record for a hit
(stripped CRT objects, anonymized staticlib helpers), the tool falls back to
section-contribution attribution: the linker-map "which `.lib` did this byte
come from" data. These attributions are stable across link layout changes.
Allowlist them literally:

```
<lib:lolhtml.lib>  [AVX, AVX2]
```

**`<no-symbol@0x...>`** — the address fell in padding between functions or the
binary is stripped. If you see these for every violation, you're scanning the
wrong binary (use `-profile`). If it's just one or two, it's usually inter-
function padding that decoded as something; investigate with `objdump -d`
around that address and, if it's genuinely junk, add a brief `# padding at
<addr range>` comment with a blanket-pass entry.

### PDB coverage drift (Windows)

A function may get an `S_LPROC32` record (real mangled name) on one toolchain
and fall through to `<lib:...>` on another. If the same code flips between
forms across CI runs, allowlist both.

## Deliberately ignored (not reported even if found)

See `src/main.rs:94-135` and `src/aarch64.rs`:

- **TZCNT** (x64) — decodes as REP BSF on pre-BMI1; LLVM preloads dest with
  operand-width so the `src==0` case matches. (LZCNT is NOT ignored —
  `BSR` ≠ `LZCNT` for nonzero inputs and LLVM never emits it for Nehalem.)
- **XGETBV** (x64) — needed by every AVX gate; a stray one SIGILLs at
  startup so the emulator catches it trivially.
- **ENDBR64 (CET_IBT), RDSSP/INCSSP (CET_SS hint-space subset)** (x64) —
  NOP-encoded on pre-CET by design. The rest of CET_SS (WRSSD/RSTORSSP/
  SETSSBSY etc.) IS flagged — dedicated opcode slots that #UD on pre-CET.
- **PACIASP/AUTIASP/BTI** (aarch64) — HINT-space, architecturally NOP on
  pre-PAC CPUs. (`LDRAA`/`LDRAB` are _not_ HINT-space and _are_ reported.)
- **3DNow!, SMM, Cyrix, VIA** (x64) — no toolchain targeting x86-64 emits
  these. When their `0f xx` encodings show up, it's data.
