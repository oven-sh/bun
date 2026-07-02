## REPORT

### unit: w3-machine-outliner

One-paragraph summary. **The x86-64 LLVM Machine Outliner is real, OFF in the
shipped canary, one relink-only flag away (`-Wl,-mllvm,-enable-machine-outliner`),
reaches 98% of `.text`, and is worth a MEASURED 5.1–8.7 MB on this binary —
bigger than the ENTIRE remaining Linux need. It is also a perf REGRESSION with
no escape hatch in LLVM 21, so per the hard constraint it is a DEAD END, reported
here with a complete, maintainer-runnable measurement package.** The one
zero-perf-cost RECOMMENDATION this unit produces is the compiler-side sibling
the brief's part (4) asked about: **`-Wl,-mllvm,-enable-merge-functions`** —
proven address-identity-safe by construction (it solves the `218430c731` bug
class structurally), a relink-only, risk-free REPLACEMENT for SYNTHESIS2's
Tier-A row 5 (`icf=all --keep-unique`) at the same ~0.25 MB.

Nothing here duplicates SYNTHESIS2's table or DISCARDED list: neither the words
"machine outliner" nor `-enable-merge-functions` appears in either, and row 5
is explicitly still "gated on a maintainer yes" because of the risks this
report removes.

---

### findings

All numbers are derived **BY ADDRESS**: a single sequential `llvm-objdump-21 -d`
pass over the canary's exact `.text` range `[0x16c4a00, 0x4b12d5a)` (52.43 MB,
13,297,687 instructions, 53,518,815 bytes disassembled — every byte visited
once, so the SYNTHESIS2 §cross-cutting-fact-1 by-NAME ICF-alias double-count
cannot occur). Toolchain used for every source claim and every mechanical test:
**LLVM 21.1.8 — byte-for-byte the version bun pins** (`scripts/build/tools.ts:267
LLVM_VERSION = "21.1.8"`; local `clang-21 --version` = `21.1.8`).

### F1 — The x86-64 Machine Outliner exists, works, and is OFF in the canary
- `llc-21 --help-hidden` lists `-enable-machine-outliner[=always|never]`,
  `-machine-outliner-reruns=<uint>` (default 0), `-outliner-benefit-threshold=<uint>`
  (default 1, `MachineOutliner.cpp:129`), `-outliner-leaf-descendants` (default true).
- Empirical: `clang-21 -O2 -mllvm -enable-machine-outliner -c probe.c` produced
  `OUTLINED_FUNCTION_0..9` on x86-64. **It IS implemented and benefit-capable.**
- `-enable-machine-outliner` with no value IS `=always` (`cl::ValueOptional`
  with the empty sentinel mapped to `AlwaysOutline`). Without the flag the pass
  is NOT EVEN ADDED on x86: `TargetPassConfig::addMachinePasses` gates on
  `RunOnAllFunctions || TM->Options.SupportsDefaultOutlining`, and only
  `AArch64TargetMachine` sets `SupportsDefaultOutlining=true`. **On x86 the
  ONLY reachable mode is `always` (= outline from every function).**
- The shipped canary has **ZERO** `OUTLINED_FUNCTION` symbols
  (`grep -c OUTLINED_FUNCTION /tmp/canary/nm-dem.txt` = 0). It is OFF today,
  and no prior unit touched it.

### F2 — The exact LLVM-21 x86 legality + cost rules (all from `release/21.x` source)
Legality, `X86InstrInfo.cpp:10644-10681` + `TargetInstrInfo.cpp:2123-2200`
(fetched from `llvm/llvm-project@release/21.x`). An instruction is ILLEGAL
(ends any candidate) if it:
- reads OR modifies **RSP**, incl. implicitly → `call`, `push`, `pop`, `leave`,
  `enter`, every `(%rsp)` spill/reload (`X86InstrInfo.cpp:10656-10668`);
- reads **RIP** → every `(%rip)` operand (`:10670-10674`);
- is a **CFI** pseudo (`:10676-10678`);
- is inline asm, a label, or has an **MBB / BlockAddress / ConstantPool /
  JumpTable** operand (`TargetInstrInfo.cpp:2158-2193`);
- is a terminator whose block has successors — **every conditional and
  intra-function branch** (`TargetInstrInfo.cpp:2158-2165`).
Function-level: functions that **use the red zone are skipped entirely**
(`X86InstrInfo.cpp:10622-10642 isFunctionSafeToOutlineFrom`); with bun's
`-mno-omit-leaf-frame-pointer` every no-call function hits the
`setUsesRedZone(MinSize>0)` branch in `X86FrameLowering::emitPrologue`.
Block-level: **a candidate cannot cross an MBB boundary** — a unique illegal
sentinel is emitted at the end of every basic block
(`MachineOutliner.cpp:396-401`: "This makes sure we won't match across basic
block or function boundaries").
Matching: post-RA `MachineInstr::isIdenticalTo` → **exact opcode, exact
physical registers, exact immediates**. (→ the brief's suggested "strip
addresses + immediates" normalization would OVER-estimate; see dead_ends D3.)

**Cost model — a documented FIXME.** `X86InstrInfo.cpp:10570-10576`:
`// FIXME: x86 doesn't implement getInstSizeInBytes ... Just assume each
instruction is one byte.` SequenceSize = the instruction COUNT; call
overhead = 1 "byte" (real `call rel32` = **5 bytes**); frame overhead = 1
(real `ret` = 1). Accept iff `k*(N-1) >= N+2`. **Measured consequence: a
non-issue** — on the real binary the FIXME causes only −0.063 MB of
growing decisions against +8.73 MB of shrinking ones (F5).

### F3 — `-Wl,-mllvm,-enable-machine-outliner` is RELINK-ONLY and reaches 98% of .text
Parsed the REAL canary linker map (`bun-profile.linker-map`), summing the
`Size` column of every `.text` input section, grouped by input file:

```
  50.880 MB  53351159 B  bun-profile.lto.o           <-- the ONE LTO object
   0.634 MB              libbun-profile.a            (boringssl .S, non-LTO brotli .c, zlib .S)
   0.377 MB              libstdc++.a
   0.031 MB              libgcc_eh.a + libgcc.a
   0.004 MB              libbun_rust.a
  ------------------------------------------------
  51.926 MB  total attributed .text
```

**98.0% of `.text` is in the single LTO-generated object.** JSC, WebCore, WTF,
the Rust, the vendored C deps — ALL bitcode, all codegen'd at the final
`ld.lld` link (`flags.ts:496-498`: `-flto=full` on linux; `:472-474`: the
WebKit prebuilt is `-lto` bitcode). A link-time `-mllvm` cl::opt therefore
reaches essentially the whole binary. lld parses `-mllvm` args in
`readConfigs` (early) and the LTO config/pipeline is constructed later — so
the opt is honored. **In-repo precedent for the exact spelling:
`flags.ts:873` already passes `-Wl,-mllvm,-whole-program-visibility`.**

Proven end-to-end (LLVM 21.1.8): a real `ld.lld-21 -flto=full
-Wl,--icf=safe -Wl,-mllvm,-enable-machine-outliner` link produced
`OUTLINED_FUNCTION_0..4`, shrank `.text` 1716→1067 B on the probe, and the
resulting binary **ran correctly**.

Only the 1.05 MB of NATIVE (non-bitcode) `.text` is unreachable. Enumerated
from the map; it is dominated by **brotli, which is compiled WITHOUT `-flto`**
(`backward_references.c.o` 160 KB, `compress_fragment.c.o` 33 KB, …
≈ 400 KB total) plus libstdc++'s locale instantiations (~200 KB) and the
boringssl/zlib hand-written `.S` kernels (~100 KB). → hand-off in overlaps.

### F4 — Why this binary is UNUSUALLY outliner-friendly (the instruction-legality census)
Full-.text classification (13.30 M instructions, 51.04 MB):

| class | instrs | %i | bytes (MB) |
|---|---:|---:|---:|
| **LEGAL** | 8,809,952 | **66.25%** | **35.67** |
| ILLEGAL_BRANCH | 1,862,048 | 14.00% | 6.65 |
| ILLEGAL_CALL | 733,160 | 5.51% | 3.43 |
| ILLEGAL_RSP_OP | 254,730 | 1.92% | 1.27 |
| PADDING (nop/int3) | 628,187 | 4.72% | 1.20 |
| NATIVE_EXCLUDED | 267,301 | 2.01% | 1.04 |
| **ILLEGAL_RIP** | 121,259 | **0.91%** | 0.88 |
| ILLEGAL_PUSHPOP | 561,394 | 4.22% | 0.85 |
| TERMINATOR (ret) | 59,656 | 0.45% | 0.06 |

Three bun build decisions — none ever analyzed from this angle — make 66.25%
of the code legal (far more than a typical C++ binary):
1. **The canary is NON-PIE** (`llvm-readelf -h` → `Type: EXEC`). Only **0.91%**
   of instructions are `(%rip)`-relative. Globals are accessed via absolute
   `imm32`/`disp32`, which `getOutliningType` PERMITS (a `GlobalAddress`
   operand is not in the illegal list — only MBB/BlockAddress/CPI/JTI are,
   `TargetInstrInfo.cpp:2193`) and which is BYTE-IDENTICAL across functions
   referring to the same global. A real generated callback
   (`WebCore::TCPSocketPrototype__writeCallback`, 0x2f16cd1) shows it: the
   `ClassInfo*` check is `cmpq $0x14ea4d0, 0x50(%rcx,%rax)` — a legal,
   matchable absolute immediate.
2. **Frame pointers are kept everywhere** (`flags.ts:360`:
   `-fno-omit-frame-pointer -mno-omit-leaf-frame-pointer`), so spills are
   `%rbp`-relative (LEGAL). Only **1.92%** of instructions touch `%rsp`.
3. **No unwind tables** (`flags.ts:382`: `-fno-unwind-tables
   -fno-asynchronous-unwind-tables`) → zero CFI pseudo-instructions.

### F5 — THE MEASUREMENT: 5.1–8.7 MB of real savings from the flag
Method (every step reproducible from the scripts in `/tmp/w3-machine-outliner/`):
1. Classify every `.text` instruction by the F2 rules.
2. **Exclude** the 1.05 MB of native ranges (F3) and all runs inside the
   7,947 leaf no-call functions (F2's red-zone skip; 1.28 MB of legal bytes).
3. **Split** maximal legal runs at every illegal instruction, at every
   function boundary, AND at every one of the **1,243,641** branch-target
   addresses (= MachineBasicBlock starts; F2's MBB sentinel). 9,234,275
   legal positions remain.
4. Intern each instruction by its **exact encoding bytes** (= the real
   post-RA `isIdenticalTo`). 602,956 distinct encodings.
5. Greedy non-overlapping repeat analysis. Each candidate (k instructions,
   B real bytes, N non-overlapping occurrences) is ACCEPTED exactly when
   LLVM would accept it (F2's rule) and priced at the REAL x86 cost
   `N*B − (5*N + B + 1)`.

Results (the forward, longest-first greedy):

```
LLVM-model accepted candidates : 212,047  (1,452,084 call sites)
  total outlined-body bytes    : 4,522,888 B  (4.31 MB of new OUTLINED_FUNCTION_N)
  REAL byte saving (the flag)  : 9,090,655 B  =  8.67 MB
  of which NEGATIVE components :   -65,603 B  = -0.063 MB  (the FIXME cost model)
  ideal (fixed cost model)     : 9,423,105 B  =  8.99 MB
```

The ONE remaining approximation is my greedy ORDER vs LLVM's benefit-sorted
greedy over the same candidate set. I bracketed it by running the EXACT
OPPOSITE order (shortest-first, the worst case): **5.13 MB**. LLVM's
benefit-sort strongly favors the high-coverage candidates, so it lands near
the high end. **Honest band: 5.1 – 8.7 MB.**

Two calibration points that make the number credible:
- Even the WORST-case greedy ordering (5.13 MB) exceeds the entire remaining
  Linux need (4.86 MB).
- The stripped-binary CI metric (`statSync(strippedExe).size`) is unaffected
  by the 212 K new local symbols — the release is stripped, so the ONLY cost
  is the 4.31 MB of outlined bodies, already in the net.

Note on composition: this was measured on the POST-`icf=safe` canary, so it is
the ADDITIVE number on top of today's ICF. Overlap with the existing Tier-A
inventory (gc-1's `createStructure`, gc-2's redis stamp, rust-mono) is
≤ 0.3–0.5 MB — immaterial against a 5–9 MB band.

### F6 — THE PERF VERDICT: the flag outlines provably-hot code (named, disassembled)
The top accepted candidates split cleanly. **HOT** (each would gain a 5-byte
`call` + `ret` per execution):

| Δbytes | k | N occ | first containing symbol | what it is |
|---:|---:|---:|---|---|
| 75,636 | 4 | **5,404** | `JSC::MacroAssemblerX86_64::callOperation<…>` | the inlined `AssemblerBuffer::ensureSpace` check (`movl 0xa8(%rbx),%ecx; movl 0xb0(%rbx),%eax; leaq 0x10(%rax),%rdx; cmpq %rcx,%rdx`). With its sibling families in `SlowPathCallGenerator::generate` (1,132), `CCallHelpers::emitShuffleMove` (666) and more, **≈8,000 inlined copies of 4 instructions** — the per-emitted-instruction inner check of EVERY JIT compile. |
| 23,962 | 10 | 429 | `JSC::DFG::SpeculativeJIT::appendExceptionHandlingOSRExit` | an 8-way AVX2 copy-loop BODY (`vmovups ×8; addq; cmpq`). Outlining puts a call INSIDE a vectorized loop, 429× |
| 18,434 | 6 | 923 | `__bun_fire_timer` (first site) | the 4 KB-page-header allocator fast path (`(p-16) & ~0xfff; load hdr; load p[-1]; test`) — the steady-state free path, inlined 923× |
| 11,015 | 24 | 108 | `mldsa::mldsa_sign_mu_no_self_test` | AVX2 NTT rounds in the ML-DSA signing kernel |
| 10,957 | 7 | 578 | `Bun::NapiHandleScopeImpl::visitChildren` (first site) | a GC-marking bit-test, 578× |
| 9,108 | 82 | 32 | `encode_one_block` | libjpeg's unrolled Huffman AC-coefficient encoder |

**COLD / one-shot** (would be ZERO cost — but there is no way to get ONLY these):

| Δbytes | k | N | symbol |
|---:|---:|---:|---|
| 11,720 | 16 | 144 | `Bun::JSStatFSPrototype::createStructure` (the ZigGeneratedClasses pattern) |
| 9,966 | 43 | 37 | `bun_ast::Log::add_error` (parse-error construction) |
| 9,402+7,876 | 19+4 | 97+564 | **inside `JSC::JITThunks::initialize`** (SYNTHESIS2 §E #3's 212 KB LTO-bloated one-shot fn) |
| 9,039 | 4 | 604 | the per-algorithm OID/length constant loads in `bun_runtime::crypto::StaticCryptoHasher::hash_` |
| 8,178 | 18 | 94 | `JSC::LazyProperty::callFunc<HTTPHeaderIdentifiers::$_93>` |

The 404 candidates with Δ>1,500 B total only 1.31 MB; the other ~7.4 MB is a
long tail of 212 K small candidates spread across ALL of JSC/Yarr/the lexer.
Raising `-outliner-benefit-threshold` keeps exactly the WORST perf offenders
(the highest-benefit candidates are the highest-N = most-inlined = hottest
helpers). There is no size/perf frontier to tune along.

### F7 — There is NO zero-regression scoping mechanism on x86-64 + full LTO in LLVM 21
This is the definitive answer to the brief's part (3)(a). Every door checked:
- `populateMapper` has **zero** hotness/profile/cold/BFI/PSI gating
  (grep of the whole of `MachineOutliner.cpp` = 0 hits).
- The ONLY per-function opt-out is `F.hasFnAttribute("nooutline")`
  (`MachineOutliner.cpp:1211`). **Clang 21 has NO spelling for it** (tested:
  `__attribute__((nooutline))` and `[[clang::nooutline]]` both →
  `unknown attribute … ignored`). `def NoOutline` / `[[clang::no_outline]]`
  exists on LLVM **main** (`clang/include/clang/Basic/Attr.td:2416`) but is
  ABSENT from `release/21.x`. It lands in LLVM 22 — and is an OPT-OUT, so
  you would have to annotate the HOT functions. Impractical either way.
- The `minsize`-scoped mode (`RunOnAllFunctions=false` →
  `shouldOutlineFromFunctionByDefault` → `hasMinSize()`) is UNREACHABLE on
  x86 from any command line (requires `SupportsDefaultOutlining`, AArch64-only).
- **Per-TU flagging cannot work.** `flags.ts`'s per-file flag mechanism exists
  (`flags.ts:1528 file: string`; `unified.ts:21,:195` — "Files with active
  per-file flag overrides (flags.ts) can't share a TU"), BUT under `-flto=full`
  the compile step only emits bitcode; the MachineOutliner is a CODEGEN pass
  that runs once, at LINK time, on the ONE merged module. A compile-time
  `-mllvm` on a bitcode TU is a no-op.

### F8 — `-enable-merge-functions` (brief part 4): confirmed, mechanism proven, safety proven
- **It reaches the full-LTO link pipeline via `-Wl,-mllvm`.**
  `PipelineTuningOptions()` ctor (`PassBuilderPipelines.cpp:321`) reads the
  `enable-merge-functions` cl::opt (declared at `:180`,
  `cl::init(false)` — so it is OFF today), and `buildLTODefaultPipeline`
  (starts `:1852`) adds `MergeFunctionsPass` at `:2185`. lld parses
  `-mllvm` BEFORE constructing `lto::Config`. Verified: `opt-21/llc-21`
  both list `--enable-merge-functions`.
- **Empirically proven on a real `ld.lld-21 -flto=full` link** with 8
  byte-identical ADDRESS-TAKEN C functions plus an explicit
  `twinA != twinB` pointer-identity check compiled into the program:
  - base (`--icf=safe` only): all 8 full bodies survive (addresses are
    taken, so safe ICF refuses) — `.text` = 1716 B. This IS the
    `218430c731` / SYNTHESIS2-row-5 population.
  - `+ -Wl,-mllvm,-enable-merge-functions`: ONE body + 7 **distinct-address**
    thunks (`pushq %rbp; movq %rsp,%rbp; popq %rbp; jmp <rep>` — 10 B,
    16-padded). `.text` = **714 B**. The program PRINTS
    `addresses-distinct=1`. **The pointer-identity check that `--icf=all`
    breaks is PRESERVED, and with no `--keep-unique` list to maintain.**
  - `-Wl,-mllvm,-enable-machine-outliner` as well: both compose; all
    variants run correctly.
- Why it is safe by construction: `MergeFunctions::mergeTwoFunctions` first
  runs `replaceDirectCallers(G, F)` (direct callers of a merged duplicate
  call the representative directly — ZERO added cost), then either
  `eraseFromParent` (if `G`'s address was never taken → bit-for-bit what
  `icf=safe` already does) or `writeThunk` (a 5-byte `jmp` at `G`'s OWN,
  distinct address). Two distinct source functions can NEVER end up at one
  address. (`-mergefunc-use-aliases` would break this — it defaults OFF;
  do not pass it.)
- **Population / composition:** `MergeFunctions` merges IR-STRUCTURALLY
  identical functions; `--icf=all` folds BYTE-identical sections. With
  LLVM 15+ opaque pointers and `cgu=1`+full-LTO's deterministic codegen,
  IR-identical ⊆ byte-identical, so MergeFunctions ⊆ icf=all's catch, minus
  the small residual `icf=all` uniquely gets (same-width-different-type
  loads, e.g. `i64` vs `double`) and minus the thunk bytes. **It OVERLAPS
  with, and is NOT additive to, SYNTHESIS2 row 5.** It is the SAFE spelling
  of the same bytes.
- Windows: `lld-link /mllvm:-enable-merge-functions` works syntactically
  (`lld-link /mllvm:-help-list` → rc=0), but Windows is ThinLTO
  (`flags.ts:507-508`) so MergeFunctions runs PER-backend-MODULE
  (`buildModuleOptimizationPipeline`, `PassBuilderPipelines.cpp:1622`) —
  intra-module only — and `/OPT:REF`+the existing ICF already covers the
  byte-level population. Credit 0 on Windows.

### F9 — Side findings for other units (see overlaps)
- **Brotli is not LTO-compiled.** ~400 KB of brotli C objects
  (`backward_references.c.o`, `compress_fragment.c.o`, …) appear as NATIVE
  inputs in the canary's final link. They miss all cross-TU LTO DCE.
- **`AssemblerBuffer::ensureSpace` is LTO-inlined ≈8,000 times** (the single
  largest repeated sequence in the binary, ~160 KB across its 5 register
  families). The single most concrete LTO-over-inlining datum of the
  investigation.
- The TWO largest sub-function repeats inside `JSC::JITThunks::initialize`
  (97×103 B + 564×19 B ≈ 21 KB) quantify SYNTHESIS2 §E #3's 212 KB lead.

---

### proposals

### MO-P1 — `-Wl,-mllvm,-enable-merge-functions` on the linux LTO link
- **id:** `w3-machine-outliner/mergefunc`
- **saving_mb:** **0.15 – 0.25** (point 0.20).
  **Derivation (by ADDRESS, not by name):** `MergeFunctions`' population is
  exactly the `--icf=all` population (F8's subset argument), and size-facts
  GT#2 MEASURED `--icf=all` at **−0.250 MB** by actually relinking the real
  objects. MergeFunctions gets that population minus (a) a ≤16-byte thunk
  per ADDRESS-TAKEN duplicate instead of `icf=all`'s 0 (at ~850 such
  functions ≈ 14 KB) and (b) the same-bytes-different-IR-types residual
  only byte-level ICF sees (small under opaque pointers). Band 0.15–0.25.
  The relink measures it exactly in minutes. I deliberately do NOT claim a
  byte-exact number: it is NOT ADDITIVE with SYNTHESIS2 row 5 and must not
  be double-counted.
- **confidence:** HIGH on the mechanism (every step empirically proven,
  F8); MEDIUM on the exact MB (bounded above by GT#2's measured 0.250).
- **risk:** LOW. `MergeFunctions` is off-by-default in clang's `-O3` — it is
  a less-exercised pass than lld's ICF. Mitigations: (1) the address-identity
  property is structural, not incidental (F8); (2) `-mergefunc-use-aliases`
  MUST NOT be passed; (3) gate on the full JSC + bun CI suite exactly as row
  5's plan already required. Link time +~10–30 s on a multi-minute LTO link.
- **perf:** **neutral.** Merged duplicates run IDENTICAL code. Direct callers
  are redirected at ZERO cost (`replaceDirectCallers`). The ONLY addition is
  one predicted direct `jmp` on the INDIRECT-call path of an ADDRESS-TAKEN
  duplicate (the JSC host-function population) — ≤1 cycle on a ≥50-cycle
  host-function dispatch, traded for strictly better I-cache density.
  Source for the argument: `llvm/lib/Transforms/IPO/MergeFunctions.cpp`
  `mergeTwoFunctions`/`writeThunk` on `release/21.x`.
- **regression:** none user-visible. Heap-profile / `bun.report` symbol
  attribution for a merged duplicate names the representative — the SAME
  already-accepted behavior as today's `--icf=safe`.
- **windows:** **NO** — ThinLTO makes it per-module; `/OPT:ICF` already
  owns the byte-level there. (Windows is already solved per the wave-3 brief.)
- **files / change (copy-pasteable):** `scripts/build/flags.ts`, the
  `── LTO (link-side) ──` block (insert immediately after the existing
  `-Wl,-mllvm,-whole-program-visibility` entry at ~:873, whose exact `flag:`
  shape it copies):
  ```ts
  {
    // IR-level function merging at LTO codegen. Folds whole functions that
    // lld's --icf=safe refuses because their addresses are significant, by
    // giving each duplicate its own 5-byte `jmp <representative>` thunk at a
    // DISTINCT address — so JSC's callHostFunctionAsConstructor
    // pointer-identity check (the --icf=all revert in 218430c731) is
    // preserved by construction, with no --keep-unique list to maintain.
    // Direct callers are rewired to the representative at zero cost; only
    // indirect (function-pointer) calls to a merged duplicate pay one
    // predicted jmp. Do NOT add -mergefunc-use-aliases (that would alias
    // the addresses and reintroduce the icf=all bug).
    flag: ["-Wl,-mllvm,-enable-merge-functions"],
    when: c => c.unix && !c.darwin && c.lto && c.release,
    desc: "LTO function merging (the address-identity-safe form of --icf=all)",
  },
  ```
  Keep `--icf=safe` (`flags.ts:1294`) — they compose; ICF still owns the
  same-bytes-different-types residual.
- **effort:** small (one `flags.ts` entry).
- **relink_only:** **YES** — a link-time `-mllvm` cl::opt; minutes.
- **relationship to the existing inventory:** this is the SAFE ALTERNATIVE to
  SYNTHESIS2 Tier-A row 5 (`icf-all-linker/icf-all-keep-unique`, 0.250 MB,
  "gated on a maintainer yes"). **Choose exactly one.** Choosing this one
  deletes row 5's entire pre-ship burden: no `--keep-unique=<mangled>`
  spelling, no 9+-site `callHostFunctionAsConstructor` audit, no 48-member
  `*Constructor::s_info` distinct-address audit, no maintainer policy call.
  Row 5 is also **NO on Windows** (`lld-link` has no `--keep-unique`), so
  nothing is lost there.

---

### dead_ends

### MO-D1 — `-Wl,-mllvm,-enable-machine-outliner` on the whole binary
**perf: REGRESSION → dead_end.** This is the brief's flagship, so it gets the
fullest possible record. If the maintainers ever relax the constraint or fund
an LLVM patch, THIS is where the bytes are.
- **saving_mb: 5.1 – 8.7** (8.67 headline), DERIVED BY ADDRESS as in F5 —
  larger than the entire remaining Linux target. `relink_only: YES`
  (F3, mechanism proven end-to-end).
- **Why it is dead:** it is precisely the mechanism size-facts names as DEAD
  ("-Os/-Oz on warm code"): it converts inline code into `call`s. It is
  ALL-OR-NOTHING on x86-64 in LLVM 21 (F7), and F6 NAMES six hot victims
  it WOULD outline — the JIT assembler's per-instruction buffer check
  (≈8,000 sites), the allocator free fast path (923 sites), a GC-marking
  bit-test (578), the body of a vectorized copy loop (429), and the libjpeg
  and ML-DSA inner loops. No benefit threshold, rerun count, or attribute
  can exclude them.
- **windows:** also no. `lld-link /mllvm:-enable-machine-outliner` is
  syntactically accepted, but ThinLTO runs the outliner per-backend-module
  (no cross-module repeats), and Windows is already solved.
- **The maintainer-runnable measurement package** (ONE relink, ~minutes, no
  perf claim required from me):
  1. Add `-Wl,-mllvm,-enable-machine-outliner` next to `-Wl,-icf=safe` at
     `flags.ts:1294` (or to the LTO link-side block at ~:873). Relink.
  2. Size oracle: `llvm-nm-21 --defined-only bun-profile | grep -c
     OUTLINED_FUNCTION` must be ≫0; compare `scripts/binary-size.ts`.
  3. Perf oracle (F6 targets): a DFG/FTL JIT-compile-heavy startup bench;
     the allocator / GC micro-benches; `Bun.Image().jpeg()`.
  4. Optional second point: add `-Wl,-mllvm,-machine-outliner-reruns=1`
     (nested outlining; more bytes, same perf character).
- **The only credible long-term path:** make the x86 outliner
  profile-aware. bun has NO PGO in CI (SYNTHESIS2 §E #6 — `.buildkite/ci.mjs`
  has 0 `pgo` hits; `--pgo-generate/use` exist at `config.ts:845-848` but
  are unwired). Even WITH PGO, the outliner has no BFI/PSI consumer on x86
  (F7) — it needs an LLVM patch. Months, not a flag. Recorded only so the
  next wave does not re-derive it.

### MO-D2 — Any SCOPED (cold-only / per-TU / per-function) x86 outliner in LLVM 21
Structurally impossible. Exhaustive proof in F7: (a) `=always` is the only
reachable x86 mode; (b) the sole per-function opt-out attribute has no clang-21
spelling (`[[clang::no_outline]]` lands in LLVM 22, and is an opt-OUT of the
hot set — impractical at 52 MB of .text); (c) there is no hotness gate in the
pass; (d) per-TU compile flags are dead under full LTO because the outliner
runs once, at link-time codegen, on the merged module. The brief's question
(3)(a) — "is per-TU/per-group flagging expressible in `unified.ts`+`flags.ts`
TODAY?" — YES the per-file flag machinery exists (`flags.ts:1528`), and NO it
cannot scope a link-time codegen pass. Closes the book for future waves.

### MO-D3 — The brief's suggested "normalize (strip addresses + immediates)" methodology
Over-estimates and must not be used by any future unit. The real matcher is
post-RA `MachineInstr::isIdenticalTo`: **exact physical registers, exact
immediates** (F2). Two sequences differing ONLY in register assignment (e.g.
the `%rbx` vs `%r14` vs `%r15` families of the AssemblerBuffer check in F6)
are DIFFERENT candidates — they are the second-, fifth-, and tenth-largest
examples INDEPENDENTLY in my data precisely because they do NOT merge. Every
number in F5 was derived with exact-encoding matching.

### MO-D4 — `-outliner-benefit-threshold=N` / `-machine-outliner-reruns=N` as a perf fix
The threshold filters by total `k*(N-1)-N-1` benefit, which is MAXIMIZED by
high-occurrence candidates, which ARE the hottest helpers (F6's #1 has
benefit 16,210, the single highest). Raising it concentrates the outlining
INTO the hot set. Reruns just nest more outlining. Neither knob knows about
hotness. Dead for perf purposes; `reruns` is only relevant to MO-D1's ceiling.

---

### overlaps

- **SYNTHESIS2 Tier-A row 5 (`icf-all-keep-unique`, 0.250 MB):** MO-P1 is its
  SAFE ALTERNATIVE — same population, none of the risks, relink-only. They
  are MUTUALLY EXCLUSIVE; the synthesizer must credit the bytes ONCE. I
  recommend MO-P1 over row 5 because it removes row 5's "gated on a maintainer
  yes" qualifier and its three pre-ship audits entirely.
- **w3-lto-pipeline:** F9's `AssemblerBuffer::ensureSpace` is LTO-inlined
  ≈8,000× (~160 KB across 5 register families) — the single most concrete
  over-inlining datum of the investigation, on a JIT-COMPILE-TIME path (not
  steady-state). The sub-function repeat structure inside
  `JSC::JITThunks::initialize` (97×103 B + 564×19 B) quantifies SYNTHESIS2
  §E lead #3.
- **w3-ci-pipeline-audit / w3-dep-internals:** F9 — **brotli is built WITHOUT
  `-flto`** (~400 KB of native `.text` confirmed by ADDRESS from the map).
  Someone should find out why and whether LTO'ing it (or at minimum
  `-ffunction-sections`+gc) is free money; it is the only large C dep
  outside the LTO partition.
- **w3-binary-archaeology / w3-code-patterns:** the full named top-candidate
  table (F6) and the underlying intern/run data are in
  `/tmp/w3-machine-outliner/` (`census2.py`, `rep.c`, `name.py`,
  `intern.txt`, `runs_*`). The legality census (F4) is a reusable map of the
  binary's instruction mix that no other unit has.
- **w2-generated-classes (SYNTHESIS2 row 9, gc-1):** F6's
  `createStructure` ×144 (11.7 KB) independently reconfirms the
  `createStructure` half of gc-1 from the opposite direction (bottom-up from
  instruction bytes rather than top-down from the generator). Same bytes —
  already credited there; not new money.
