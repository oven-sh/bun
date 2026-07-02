# REPORT
## unit: w3-binary-archaeology

All numbers derived BY ADDRESS from `/tmp/canary/bun-linux-x64/bun`
(76,889,912 B), its unstripped twin, its linker map, and the canary's OWN
`Bun.zstdCompressSync({level:19})` (the in-tree codegen level,
`src/node-fallbacks/build-fallbacks.ts:81`). Scripts: `/tmp/w3-binary-archaeology/
{census.py,lmap.py,rodata_entropy.py,measure.ts,dups.py,hardening.py,outliner2.py}`.

## findings

### F1 — THE CORRECTED CENSUS (mandatory #1). The linker map, not nm, is the truth for .rodata
By-NAME nm sums 79,855 lines onto 71,184 unique addresses (8,671 ICF/alias
phantoms — consistent with wave-2's 2.46-2.55 MB counting-bug finding). But
the bigger problem the census brief named is that **nm cannot see most of
.rodata at all**: symbol sizes cover only 4.78 of .rodata's 20.62 MB. The
canary's LINKER MAP (`bun-profile.linker-map`) carries per-INPUT-SECTION
attribution even through full LTO and explains **100% of .rodata** (29,540
input sections summing to 20.60 MB, a 0.02 MB rounding residue):

| .rodata bucket (from the map) | MB | n | prior claim |
|---|---|---|---|
| ICU data blob | 11.041 | 1 | GT#1 CLOSED |
| other-named (ICU code tables, bssl, encoding_rs, …) | 2.642 | 9,151 | partial |
| `Bun::InternalModuleRegistryConstants::*CodeBytes` (the 158 embedded JS modules) | 1.676 | 158 | SYNTHESIS2 row 3 (EJ1) |
| **rust `.rodata..Lanon.*` (anonymous consts)** | **1.303** | **16,385** | **NOBODY — new** |
| **`<internal>:(.rodata.str1.1)` lld merged string pool** | **1.136** | **10** | **NOBODY — new** |
| JSC named .rodata | 0.963 | 1,587 | partial (Yarr counted separately) |
| brotli dicts | 0.394 | 5 | row 6 |
| PAL codec tables | 0.312 | 34 | row 2 |
| JSC::Yarr tables | 0.278 | 125 | B4 |
| `combinedSourceCodeBuffer` + `s_JSCCombinedCode` (JS builtins) | 0.371 | 2 | EJ2/B7 |
| WebCore named | 0.225 | 915 | — |
| .rodata.cst* merged consts | 0.090 | 4 | — |
| rtti (_ZTS/_ZTI) | 0.028 | 927 | GT "dead" |
| vtables (_ZTV), asm `.S` objects, lto.o unnamed | 0.120 | 156 | — |

`.text` by root namespace after stripping demangled return-type prefixes and
deduping by ADDRESS (fixes the brief's "C:other 4.5 MB / return-type 2 MB"):
JSC **17.61** | bun_runtime 3.69 | WebCore 2.97 | WTF 1.99 | bun_css 1.83 |
bun_js_parser 1.40 | Bun(C++) 1.36 | bun_install 1.35 | rust-std 1.29 |
icu_75 0.97 | core 0.95 | bun_react_compiler 0.87 | bun_bundler 0.76 |
bun_jsc 0.59 | bun_js_printer 0.54 | bssl 0.50 | Inspector 0.36 | … .
`.text` input-section sum: `bun-profile.lto.o` 50.88 MB + libstdc++ 0.30 MB +
libbun-profile.a asm/.S objects 0.58 MB + libgcc_eh 0.03 MB.
**No multi-MB bucket remains unexplained.**

### F2 — The two NEW .rodata seams, characterized
**(a) `.rodata.str1.1` = 1,182,857 B at vaddr 0x212660.** The two largest
"unnamed gaps" a symbol walk reports (441,037 B after
`chacha20_poly1305_constants` + 742,273 B after `sqlite3_str_vappendf.zOrd`)
ARE this one pool, split by two named symbols that happen to sit inside it.
Contents (31,242 NUL-terminated runs): **120 Mozilla root certificates as
base64 PEM text = 179,722 B = 15.2% of the pool** (→ proposal P2);
compiled `pretty_fmt!` descriptors; TinyCC predefines (5,098 B); etc.
`zstd -19` of the whole pool = 377,697 B (0.32) — 0.8 MB of redundancy with
no safe mechanism to recover it (the pool IS the linker's merged form).
**(b) rust `.Lanon` = 1,366,775 B in 16,385 sections.** I identified every
large one. The 5 high-entropy (8.0 bits/byte) blobs in the
`cf40a23b…`/`16b0147…` CGUs are `28 b5 2f fd` = **zstd frames**: they are
the `node-fallbacks/*.js.zst` that `build-fallbacks.ts:81` ALREADY
compresses (e.g. `.Lanon.…71` at 0x11167e0 is `assert.js.zst`, **byte-exact
23,471 B**). One is a **gzip** frame (`1f 8b 08`) = `welcome-page.html.gz`
(22,166 B). The large LOW-entropy ones are the UNcompressed cold assets that
proposal P1 claims. The rest is the `ComptimeStringMap` key arrays
(`(ptr:8,len:8)` per entry; the MIME table alone is 2,310 entries × 16 B).

### F3 — The entropy / compressibility sweep (mandatory #2; = SYNTHESIS2 §E lead #4's ask)
For EVERY .rodata input section ≥ 16 KB: Shannon entropy + zstd-19. Highlights
not already owned by a prior row:
`lto.o:(.rodata)` at 0xedec80 = 66,752 B, ratio **0.03**;
`Bun::StringWidthTables::kGraphemeBreakStage1/2` = 48,896 B, ratios
**0.02/0.06**; `JSC::OptionsHelper::g_constMetaData` 21,440 B, 0.25;
`encoding_rs::VariantEncoder::encode_from_utf*` 28,248 B, 0.06;
`bssl::kObjects` 38,920 B, 0.24. Already-claimed rows reconfirmed
(`ecp_nistz256_precomputed` ent 8.00, incompressible, per GT).
Full table in `/tmp/w3-binary-archaeology/rodata_entropy.out`.

### F4 — Inter-symbol gaps (mandatory #3)
`.text`: total gap (by unique-address extents) = **0.528 MB**. Binary-wide
trailing-`int3`-per-function (the real alignment measure) = **545,247 B =
0.520 MB** — an EXACT, independent confirmation of GT "function alignment is
0.52 MB, perf-locked". Correction: **145,468 B (0.139 MB) of that 0.520 MB is
NOT compiler alignment** — it is JSC's Wasm IPInt fixed-stride jump table
(759 `ipint_*` handlers at 256/512-byte stride, 247,214 B extent, 0.139 MB of
explicit `int3` fill). Same *bytes*, different *lever* (offlineasm stride, not
`-falign-functions`). The `ipint_*_validate` set is a full SECOND 235,968-B
dispatch table (750 handlers). Both are load-bearing (`shl $8; add; jmp *%rax`
dispatch). Handed to w3-webkit-build-options (F8.3).
`.rodata`: 15.84 MB of "gap" = all named by the map (F1). Nothing unnamed.

### F5 — `strings` repetition (mandatory #4)
Outside the merge pool + embedded JS, the repeated ≥24-char strings are:
the **zsh/fish/bash completion scripts** (each flag block repeated 6-9×
*inside* `completions/bun.zsh` itself — it copy-pastes the install/add/
update/remove blocks), the 3 `bun init` react templates (`logo.svg` etc. land
at ONE address — rustc already deduped the identical files), and
`runtime.js`. I VERIFIED wave-1 row 19: the "named exports" sentinel appears
8× = 2-per-copy × **4 copies**. Row 19's count is CORRECT. No new large
un-merged string population exists.

### F6 — Instruction-repetition data for w3-machine-outliner (mandatory #5)
5 windows × 1 MB (9.2% of .text), 8,195 functions, 1.24 M instructions.
**My first pass (immediates normalized away) gave 13.1 MB — that number is
WRONG and must not be used**: its #1 "candidate" was inter-function `int3`
padding (not outlinable) and #2/#3 were full prologues/epilogues (x86's
`X86InstrInfo::getOutliningTypeImpl` rejects SP-modifying instructions).
**The STRICT run** (MI-identity: immediates + registers kept exactly;
`call`/`jmp` targets → the symbol; any instruction touching
`%rsp/%rbp/%rip`, any branch/ret/int3, marked ILLEGAL; trailing `int3`
trimmed; LLVM's x86 cost model `(N-1)·S − 5N − 1`; greedy non-overlapping):
> **126,675 B saved on the 5.06 MB sample = 2.505% → ~1.31 MB extrapolated
> to the 52.3 MB .text.**
The candidate population: `WTF`/`RefPtr` move+null sequences (N=122),
JSC sign-bit/metadata writers (N=63 each ×5 variants), and an
assert/`WTF::PrintStream::print(file,line)` tail loading the SAME two
.rodata string pointers at **64 call sites**. Caveats I cannot resolve:
(i) 9.2% sample; (ii) the top families look like cold C++ boilerplate, but
the `RefPtr` one is plausibly hot — **I make NO perf claim; this is input
data for w3-machine-outliner, who owns the perf argument.**
STRICT whole-function duplicates: 0.173 MB extrapolated — dominated by
`generate-jssink.ts`'s 6 byte-identical `JS*Sink{Controller,}::
{visitChildren,analyzeHeap}` sextuplets, which `--icf=all` (SYNTHESIS2
row 5) already folds. Not new money.

### F7 — Anything weird (mandatory #6): three corrections/confirmations to the RECORD
**(a) GT#7 needs a literal footnote.** The shipped canary DOES contain
`endbr64` (1,633 × 4 B = 6,532 B) and a stack protector (399
`callq __stack_chk_fail@plt` sites + 278 `mov %fs:0x28,%rax` canary loads ≈
12,768 B). Both are **exclusively from the prebuilt distro libstdc++.a /
libgcc objects** (e.g. `std::time_get<wchar_t>::do_get_year` at 0x17c4a00),
NOT from bun's flags, total only ~0.019 MB, and are a strict subset of
Tier-B row B1's bytes. A skeptic who greps `__stack_chk_fail` will
"refute" GT#7's literal wording; this footnote pre-empts that.
**(b) Independent byte-exact CONFIRMATION of PR #33224's linux strip delta.**
A second `llvm-strip-21 --strip-all` on the ALREADY-"stripped" shipped
canary removes **exactly 42,288 B** and the binary still runs. The fix
(`--strip-all` ONLY; the old `--strip-all --strip-debug --discard-all`
spelling let GNU strip's last-flag-wins enum DOWNGRADE to debug-only) IS
commit `6f5ef8a632` ("build: fix strip flag downgrade, drop legacy .hash
…") = **PR #33224**; the canary (`eba370b69`) predates it. 42,288 +
`.hash` 8,104 ≈ #33224's CI-measured -56.7 KB. **Already banked. 0 new
money — but this is the first by-address verification of that PR.**
**(c) 48 KB of ZERO-FILLED PROGBITS.** `.bun` (16,384 B), `__DATA,
__jsc_opcodes` (16,384 B), `__DATA,__wtf_config` (16,384 B) are each 100%
`0x00` in the file. Wave-1 B6 (0.032 MB) covers the two `__DATA` ones; the
`.bun` one (→ P4) is unclaimed.

---

## proposals

### P1 — ba-zstd-cold-embedded-assets
**saving_mb: 0.224** (234,482 B). DERIVED BY ADDRESS, each asset located at
an exact vaddr in the canary and compressed with the canary's own
`Bun.zstdCompressSync({level:19})` (= `build-fallbacks.ts:81`'s level):
| group | bytes in canary (sum of the per-asset vaddr hits) | zstd-19 | saves |
|---|---|---|---|
| (a) `bun completions` scripts: `bun.zsh` 38,720@0x11e3f6a + `bun.fish` 9,425@0x11ed6aa + `bun.bash` 8,671@0x11e1d8b | 56,816 | 11,033 | 45,783 |
| (b) bake dev-server / browser-destined JS: `bake.client.js` 48,509@0x115c454, `bake.error.js` 23,844@0x119b5e0, `bake.server.js` 10,989@0x116b7c9, `bun-error/index.js` 43,963@0x117341d, `bun-error.css` 13,140@0x11700c9, `fallback-decoder.js` 8,976@0x117dfd8, `node-fallbacks/react-refresh.js` 4,810@0x11845a8, `bun-framework-react/{client,server,ssr}.tsx` 15,113+8,534+14,255@0x1185872/0x118937b/0x118b4d1 | 192,133 | 68,472 | 123,661 |
| (c) `bun:ffi cc()` headers written to a TEMP FILE: `FFI.h` 11,822@0x1148b45 + `ffi-std*.h`+`libtcc1.c` 18,418 (6 vaddrs listed in measure output) | 30,240 | 8,594 | 21,646 |
| (d) `bun init`/`bun create` templates (51 unique blobs, deduped by address) | 53,837 | 14,077 | 39,760 |
| (e) `welcome-page.html.gz` is embedded as GZIP (22,166 B @0x11cd63d); re-encode zstd-19 | 22,166 | 18,534 | 3,632 |
**perf: neutral** (groups a, d: one-shot CLI commands that write and exit;
group c: bytes are WRITTEN TO DISK for tinycc) **or one-time-lazy(bake
dev-server / error-page first-serve)** for group (b). NOT ONE of these
assets is executed by bun's JSC, is reachable from `bun run`/`bun test`/
`bun install`/`bun build` without `--app`/bake, or is on any benchmarked
path. **The load-bearing perf argument is a PRECEDENT the maintainers
already shipped in this exact codebase**: `src/resolver/node_fallbacks.rs:
28-35` — "Release builds embed the zstd-compressed `<name>.js.zst` … and
decompress it lazily on first access … everything else stops paying ~1 MB
of .rodata for the plain text." Its mechanism (`::bun_zstd::decompress_alloc`
into a `bun_core::Once<String>`, `node_fallbacks.rs:42-67`) and its codegen
(`build-fallbacks.ts:81`) are the EXACT reusable pieces. And the single
biggest asset, `bake.client.js`, is ALREADY heap-copied into a
`OnceLock<Box<[u8]>>` today (`bake_body.rs:1447-1456`), so its per-process
RSS does not change at all.
**regression:** none user-visible. Debug builds keep the non-embed path
(`cfg(not(bun_codegen_embed))` already reads from disk). Honest RSS ledger
for group (b): ~192 KB of file-backed `.rodata` → per-process heap, but
ONLY for a process that starts the bake dev server / renders the browser
error page, and the biggest item already pays it.
**windows: yes, 0.224** (PE `.rdata`; the same 234 KB).
**files / change (literal):**
1. `src/bun_core/util.rs:3146-3189` — add `CodegenZstd` / `SrcZstd` arms to
   `runtime_embed_file!` whose `cfg(bun_codegen_embed)` branch is the body
   already at `src/resolver/node_fallbacks.rs:42-67`
   (`include_bytes!(…".zst")` → `bun_zstd::decompress_alloc` → a per-site
   `Once<String>`). The non-embed branch is unchanged.
2. Codegen writes the `.zst` sibling: `src/codegen/bake-codegen.ts` (after
   the existing outputs, line ~206), `src/codegen/client-js.ts`
   (bun-error), `scripts/build/codegen.ts` (a new 5-line build edge for the
   `Src*` assets). Template: `build-fallbacks.ts:74-81`.
3. Flip the call sites: `src/runtime/bake/bake_body.rs:514,518,522,593,
   1461,1466`; `src/runtime/bake/DevServer.rs:5495`;
   `src/js_parser/parser.rs:466,471,476`; `src/runtime/ffi/mod.rs:232` +
   `ffi_body.rs:1958,2582-2584`; `src/runtime/cli/shell_completions.rs:
   10-12`; `src/runtime/cli/init_command.rs:950-953,1467,1739-1830`;
   `src/runtime/cli/create/SourceFileProjectGenerator.rs:816-925`;
   `src/runtime/api/welcome-page.html.gz` (re-encode + swap `gunzipSync`
   for `bun_zstd::decompress_alloc` at its one reader).
**effort: medium** (the mechanism exists; ~22 call sites, one macro arm,
~3 small codegen edits). **relink_only: NO — rebuild.**
**confidence: high. risk: low.**

### P2 — ba-root-certs-pem-to-der
**saving_mb: 0.049** (51,704 B) — or **0.084** (88,273 B) with the zstd
variant. DERIVED BY ADDRESS: `grep -a -c '-----BEGIN CERTIFICATE-----'
/tmp/canary/bun-linux-x64/bun` = **exactly 120** (no second copy); the 120
PEM bodies live in `.rodata.str1.1` (0x212660..0x3332e9) and total
**179,722 B** (incl. NUL). Base64-decoded to DER they are **128,018 B**
(saves 51,704). The concatenated DER zstd-19's to **91,449 B**
(saves 88,273).
**perf: IMPROVEMENT.** Today `packages/bun-usockets/src/crypto/
root_certs.cpp:56-76` parses each cert with `PEM_read_bio_X509` (a `BIO`
alloc + PEM header scan + base64 decode per cert), all inside ONE
`std::call_once` (`root_certs.cpp:152`). DER uses `d2i_X509` directly —
**the SAME file already does exactly this on its Windows system-cert path
(`root_certs.cpp:305`)**. `src/http/HTTPThread.rs:1311` documents this
init as a measured "~0.7 ms CPU" cost the maintainers already cared enough
about to make once-per-process; this makes it strictly cheaper.
**regression:** `tls.rootCertificates` / `tls.getCACertificates()`
(`src/jsc/bindings/NodeTLS.cpp:24` → `us_internal_raw_root_certs`,
`root_certs.cpp:167-170`) return PEM strings in Node. The implementer must
PEM-render lazily (once, cached) at THAT call — an introspection API, not
a hot path. This is the only consumer of the raw text form; I grepped all
of `src/`.
**windows: yes, 0.049 / 0.084** (same header on all platforms).
**files / change:** regenerate `packages/bun-usockets/src/crypto/
root_certs.h` (the generator `generate-ca-bundle.pl` / `generate-root-
certs.js` is named in its own header comment) to emit
`static const us_cert_der_t root_certs_der[]` (ptr,len into one DER blob);
`root_certs.cpp:63-67`: replace `BIO_new_mem_buf` + `PEM_read_bio_X509`
with `d2i_X509(NULL, &p, len)`; add a lazy PEM renderer for
`us_internal_raw_root_certs`. The zstd variant additionally ships ONE
zstd blob and decompresses it inside the existing `call_once`.
**effort: medium.** **relink_only: no — rebuild.**
**confidence: high. risk: low (the DER↔PEM round-trip is exact; 0/120
decode failures).**

### P3 — ba-highway-dead-isa-targets
**saving_mb: 0.052** (54,898 B). DERIVED BY ADDRESS from nm-dem.txt, deduped:
`bun::/bun_image::N_SSSE3::*` = 46 fns, **27,457 B**; `…N_SSE4::*` = 46 fns,
**27,441 B**. (Total Highway per-ISA .text: 208,324 B across 7 targets:
SSSE3, SSE4, AVX2, AVX3, AVX3_DL, AVX3_ZEN4, AVX3_SPR.)
**perf: neutral — the code is PROVABLY UNREACHABLE.** `bun-linux-x64` is the
non-baseline build, compiled `-march=haswell` (`scripts/build/flags.ts:76`);
bun ships a separate `bun-linux-x64-baseline` for pre-AVX2 CPUs
(`packages/bun-release/npm/bun/README.md:21-26` — "without AVX2
instructions"; `packages/bun-release/src/platform.ts:9` is the `avx2`
CPUID gate). A haswell-compiled binary contains unconditional AVX2
instructions, so NO CPU that lacks AVX2 can run it; on every CPU that CAN,
`hwy::SupportedTargets()` ≥ HWY_AVX2 and the dispatch NEVER selects
N_SSSE3/N_SSE4.
**ROOT CAUSE — the /GS- lesson, precisely.** `clang -march=haswell -E -dM`
defines `__AVX2__ __BMI2__ __FMA__ __F16C__ __PCLMUL__ __SSSE3__ __SSE4_1__`
but **NOT `__AES__`** (verified on clang-21: AES-NI is a firmware-disableable
feature, so LLVM's `-march` levels exclude it). Highway's
`vendor/highway/hwy/detect_targets.h:618-619` requires `HWY_CHECK_PCLMUL_AES`
(= `__PCLMUL__ && __AES__`) for `HWY_BASELINE_SSE4`, which gates
`HWY_BASELINE_AVX2` (`:625-630`). With `__AES__` absent:
`HWY_BASELINE_AVX2 = 0` → `HWY_STATIC_TARGET = HWY_SSSE3` (`:739`) →
`HWY_TARGETS = attainable & (SSSE3-and-better)` (`:970-972`) = **exactly the
7 targets in the canary.** Nobody chose this; it is an interaction between
LLVM's `-march` feature set and Highway's baseline derivation.
**BONUS (a perf bug, free to the maintainers):** `HWY_STATIC_TARGET` being
SSSE3 instead of AVX2 means any `HWY_STATIC_DISPATCH` site compiles the
SSSE3 body. bun's 5 highway TUs (`src/jsc/bindings/{xxhash3,
highway_sourcemap,image_resize,highway_strings,highway_json}.cpp`) all use
`HWY_DYNAMIC_DISPATCH` so there is no CURRENT perf loss, but the binary is
one `HWY_STATIC_DISPATCH` away from silently running SSSE3 on a haswell
build.
**regression:** none on `bun-linux-x64`. **Must be gated
`c.x64 && !c.baseline`** — the `-baseline` (nehalem) build legitimately
needs SSSE3/SSE4.
**windows: yes ~0.05** (the windows x64 release also ships a `-baseline`
variant; same gate).
**files / change (two equivalent spellings — a maintainer picks one):**
- *(root-cause fix)* `scripts/build/flags.ts`, in `cpuTargetFlags`
  (line 49), add: `{ flag: "-maes", when: c => c.x64 && !c.baseline,
  desc: "Haswell+ has AES-NI; -march=haswell omits it, which demotes
  Highway's baseline to SSSE3 and compiles 2 unreachable ISA variants" }`.
  This is the honest fix but raises a POLICY question (it lets clang emit
  AES-NI in principle — it never does outside intrinsics, and bun's
  boringssl already runtime-dispatches AES-NI, but a maintainer must say
  the word).
- *(zero-policy, Highway-official escape hatch)* `scripts/build/flags.ts`
  `bunOnlyFlags`: `{ flag: "-DHWY_WANT_SSE4=1", when: c => c.x64 &&
  !c.baseline, … }` — `detect_targets.h:618` documents this override; it
  satisfies `HWY_BASELINE_SSE4` without changing the compiler's feature
  set. Safe for bun's op set (no `CLMul`/`AESRound` callers in `src/`).
**effort: small (ONE flag-table line). relink_only: NO — rebuild of the 5
highway TUs.**
**confidence: high on the 0.052 size + the unreachability; medium on which
of the two spellings the maintainers prefer.**

### P4 — ba-bun-section-nobits
**saving_mb: 0.016** (16,384 B). DERIVED: the `.bun` section is 16,384 B of
`0x00` in the shipped canary (PROGBITS, WA, align 16384), verified by `dd`+
`tr -d '\0' | wc -c` = 0. Source: `src/jsc/bindings/c-bindings.cpp:1078`
`extern "C" BlobHeader __attribute__((section(".bun"), aligned(
BLOB_HEADER_ALIGNMENT), used)) BUN_COMPILED = { 0 };` — a zero-initialized
placeholder so `bun build --compile`'s `write_bun_section`
(`src/standalone_graph/StandaloneModuleGraph.rs:1393`) can find the section.
**perf: neutral** (runtime reads the section from memory; a NOBITS WA
section is .bss-mapped zeros, identical).
**regression: the one to verify.** `write_bun_section` must accept a
`SHT_NOBITS` source section (it rewrites the ELF and grows the section to
the real payload size anyway). This is the SAME `@nobits` named-section
mechanism as wave-1 row **B6** (the two `__DATA,__jsc_opcodes` /
`__DATA,__wtf_config` 16-KB zero sections, also verified 100%-zero here);
B6 claims 0.032 and P4 is the independent 3rd 16 KB.
**windows: no** — the PE `.bun` section (`src/exe_format/pe.rs:201`) is a
separate mechanism; credit 0 on Windows until checked.
**files / change:** `c-bindings.cpp:1078` → the named-nobits attribute
spelling (`section(".bun,\"aw\",@nobits#")`) OR (simpler, same file bytes)
drop the `aligned(16384)` to `aligned(8)` if 16 KB of headroom is not
actually required by `write_bun_section`'s in-place path.
**effort: small. relink_only: yes (a relink shows the delta) but the
`--compile` test suite must pass. confidence: medium. risk: medium
(the only proposal here that touches a feature's write path).**

---

## dead_ends

1. **zstd the 158 `InternalModuleRegistryConstants::*CodeBytes` (1.68 MB →
   ~0.35 MB; a "1.33 MB breakthrough" on paper).** The compression ratio is
   real (0.21). REJECTED under the hard constraint: unlike P1's assets,
   `node:fs`/`node:http`/`node:util` are loaded by nearly every process, and
   JSC's `SourceProvider` keeps the source string alive for the code block's
   lifetime (stack traces, `toString`). Today that text is file-backed,
   shared, 0 private RSS; after, it is per-process heap. This is a STRICTLY
   WORSE version of SYNTHESIS2 row 6's †-flagged brotli tradeoff, on a hot
   path. The RIGHT lever on those bytes is the already-banked EJ1
   minify-whitespace (row 3). If a maintainer ever wants this anyway, split
   hot (fs/http/events/util) from cold (http2 151 KB, wasi 70 KB,
   readline 56 KB) first — but that is a Tier-C maintenance burden.
2. **The 1.14 MB merged string pool's 0.80 MB of zstd redundancy.** No
   mechanism: it IS the linker's maximally-merged form.
3. **`Bun::StringWidthTables::kGraphemeBreakStage{1,2}` (48,896 B, zstd to
   2,234 B).** `src/jsc/bindings/stringWidth.cpp:62-63` does a per-codepoint
   2-stage lookup. No lazy one-time init point exists; a
   decompress-into-`.bss` would add an `is_initialized` branch to a
   per-codepoint path. PERF-LOCKED as designed. (If anyone finds a lazy
   init point for `Bun.stringWidth`, this is a clean 46 KB.)
4. **The IPInt `int3` stride padding (0.139 MB) and the second `_validate`
   table (0.225 MB).** The 256-byte stride IS the dispatch
   (`shl $8; add; jmp *%rax`); halving it needs proof that every handler
   body fits in 128 B (my measurement was confounded by a size-0 tail
   symbol). These bytes are part of GT's already-closed 0.520 MB alignment
   number. → w3-webkit-build-options owns `ipint.asm`.
5. **My raw-byte "icf=all ceiling" of 0.039 MB does NOT refute the MEASURED
   0.250.** Post-link, two icf=all-foldable twins have DIFFERENT `rel32`
   bytes (relative from each call site), so raw-byte hashing of the linked
   binary cannot see them. The 0.250 relink measurement is the only valid
   number. Do not let any wave-3 unit "re-derive" it my way. (Methodology
   note for everyone.)
6. **Highway AVX3/AVX3_DL/AVX3_ZEN4/AVX3_SPR collapse (~93 KB).** A real
   perf question (VBMI2 on Ice Lake+); only 10,985 B is raw-byte-identical
   (and icf=all gets that). Not proposing.
7. **Re-stripping the shipped binary (-42,288 B).** ALREADY SHIPPED in
   PR #33224 (commit `6f5ef8a632`). See F7(b). Do not double-count.
8. **The `pretty_fmt!(fmt, true)` / `(fmt, false)` colored+plain pair**
   (`src/bun_core/output.rs:1651-1668`) is a real duplication pattern, but
   lld's tail merge already folds the shared suffix where one exists, and
   the only fix (strip ANSI at runtime) is a per-print perf cost. →
   w3-code-patterns owns the macro families; this one is small.
9. **`endbr64` / stack-protector removal.** Only ~0.019 MB, all in
   libstdc++, subsumed by Tier-B row B1. See F7(a).

## overlaps
- **w3-machine-outliner**: F6 IS the data it asked for. USE THE STRICT
  number (1.31 MB at 2.5%), NOT the 13 MB loose one. It owns the perf call.
- **w3-dep-internals**: P3 (Highway) is a `scripts/build/deps/highway.ts`
  / `flags.ts` finding; the welcome-page gzip (P1e) and the already-
  compressed node-fallback `.zst` blobs bound its zstd/brotli search.
- **w3-webkit-build-options**: F4's IPInt stride + `_validate` table; F6's
  JSSink `visitChildren` sextuplets (a `generate-jssink.ts` sibling of
  the claimed `generate-classes.ts` rows); the 212 KB `JITThunks::
  initialize` and 100 KB `JSGlobalObject::init` confirmed as the #1/#6
  largest .text symbols.
- **w3-cpp-compile-flags**: P3's `-march=haswell`-omits-`__AES__` is a
  second live instance of the /GS- lesson, in the LINUX driver.
- **w3-code-patterns**: F2's `pretty_fmt!` dual emission;
  `bun_core/comptime_string_map.rs`'s 16-B/entry `(ptr,len)` key arrays.
- **SYNTHESIS2 rows NOT duplicated here**: EJ1/EJ2 (the 158 module sources
  and the JSC builtins — F1 re-attributes them, claims 0), row 6/B4
  (brotli/Yarr), row 2 (PAL), row 19 (runtime.js ×4 — count CONFIRMED),
  row 5 (icf=all — F6's JSSink finding is covered by it), B6 (the two
  `__DATA` zero sections).

## BOTTOM LINE
New, skeptic-verifiable Tier-A money: **P1 0.224 + P2 0.049 + P3 0.052 =
0.325 MB** certain (+0.035 with P2's zstd variant, +0.016 with P4 ⇒
**~0.376 MB ceiling**), every byte located at an address in the shipped
canary. Plus 5 record corrections (F7) and the complete census + the
machine-outliner dataset two sibling units need. I did NOT find a single
1-MB lever hiding in the binary's data sections; what I found instead is
that **the maintainers already invented the right mechanism
(`node_fallbacks.rs` + `build-fallbacks.ts`) and applied it to only one of
the ~6 asset families it fits** — P1 is "finish the job they started."
