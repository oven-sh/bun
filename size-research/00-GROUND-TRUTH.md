# Bun binary size facts (measured from the real binaries; survives container restarts)

## !! THE REAL GOAL (set by the maintainers; use these numbers) !!
The "20 MB smaller" target is measured AGAINST THE BUN 1.3.14 RELEASE. CI's
per-platform binary-size tracker (`scripts/binary-size.ts`, the "Binary size"
Buildkite annotation on every build) is the AUTHORITATIVE source. With the
orchestrator's already-opened PR #33224 (CI-measured: -56.7 KB linux,
-252 KB on all 3 windows targets), the ledger is:

  platform           1.3.14 release   with #33224   need <=   REMAINING
  bun-linux-x64      88.46 MB         73.32 MB      68.46     4.86 MB
  bun-windows-x64    93.92 MB         75.92 MB      73.92     2.00 MB

(The 1.3.14 linux baseline is verified to the byte: the official release
download is exactly 92,752,752 bytes = 88.46 MiB, and a copy is at
/tmp/official/bun-linux-x64/bun.) macOS is out of scope.

## !! HARD CONSTRAINT from the maintainers !!
Every proposal must be PERFORMANCE NEUTRAL OR AN IMPROVEMENT. Not "a small
regression", not "an acceptable tradeoff". Proposals whose mechanism is
"make X slower to make it smaller" (-Os/-Oz on warm code, removing SIMD,
UPX, lowering JIT tiers, OPENSSL_SMALL) are DEAD and belong in dead_ends.
"Lazy-decompress a COLD item on first use, cached forever" is allowed ONLY
on paths that are already lazy one-time initialization. The maintainers
(Jarred + Dylan) have explicitly said they WILL "change lots of code", so a
large-EFFORT change at zero perf cost is fully in scope.

## !! GROUND TRUTH THE ORCHESTRATOR HAS ESTABLISHED AND MEASURED !!
(Do NOT re-derive; do NOT contradict without new evidence; CITE these.)
1. THE ICU DATA AVENUE IS 100% CLOSED on BOTH axes. oven-sh/WebKit's
   `icu/compress-data.ts` already per-item zstd-compresses everything its
   `icu/keep-raw.txt` does not list, and keep-raw.txt is the author's
   (Dylan Conway) per-item, MEASURED exclusion log with a written reason
   per item; the orchestrator benchmarked and CONFIRMED every one of its
   stated costs, and programmatically verified 0 bytes of still-raw ICU
   data are unexplained by that file. Separately, the shipped icudt ToC
   contains ZERO .cnv, cnvalias, unames.icu, translit/, or rbnf/ items, so
   the "drop unreachable items" axis is ALSO empty.
2. MEASURED by actually RELINKING the real objects (do not re-estimate):
   --icf=all is exactly -0.250 MB and bare --icf=all is UNSAFE (commit
   218430c731 reverted it; the root cause is JSC's pointer-identity check
   on the callHostFunctionAsConstructor sentinel; lld's
   `--icf=all --keep-unique=<that symbol>` is the surgical fix, already
   smoke-tested clean on a 1,282-function constructor probe, the full
   expect.test.js with its 74 expect.any() sites, and the intl suite).
   --hash-style=gnu is -16 KB (SHIPPED in PR #33224). -z noseparate-code
   is 0. -Wl,-O2 is already set.
3. The embedded JS builtins (158 modules, 1,756,999 bytes of source in
   .rodata; src/codegen/bundle-modules.ts) are NOT whitespace- or
   identifier-minified. minify-whitespace is ~0.39 MB, high confidence,
   and a PERF IMPROVEMENT (less source to lex). Identifier minification is
   blocked by bundle-modules.ts's post-processing regexes.
4. Path remapping (rust --remap-path-prefix + C/C++ -ffile-prefix-map) is
   ALREADY done; ~131 stray bytes leak. NOT an avenue.
5. The build already uses LTO=full on linux CI, --gc-sections, -Wl,-icf=safe,
   -ffunction-sections/-fdata-sections, no .eh_frame. THE EASY LEVERS ARE
   PULLED. scripts/build/flags.ts documents every flag.
6. The rust release profile (Cargo.toml) is ALREADY OPTIMAL GLOBALLY:
   `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`,
   `debug = "line-tables-only"` (deliberate, for bun.report; the post-link
   strip removes it), and opt-level / overflow-checks / debug-assertions
   are at cargo's optimal release defaults. The per-crate
   `[profile.release.package."X"] opt-level = "z"` for COLD crates is the
   remaining lever (precedent: `bun_react_compiler` already has `"s"`).
7. FALSIFIED on the real shipped canary by disassembly + symbol
   fingerprints (do NOT propose; DO cite): there is NO stack protector,
   NO CET/endbr64, NO spectre retpolines, NO rust unwind landing pads,
   NO overflow-checks, and only ~3 C++ exception-personality symbols leak
   through -fno-exceptions. The "an accidental flag taxes every function"
   hypothesis is exhaustively falsified.
8. Wave 2 FALSIFIED the derive(Debug) hypothesis: bun's fat LTO +
   codegen-units=1 ALREADY dead-strips unused Debug impls. saving ~0.

## The CANARY (the REAL shipped LTO binary) is on disk: USE IT
- /tmp/canary/bun-linux-x64/bun                  76,889,912 B = 73.33 MB.
- /tmp/canary/bun-linux-x64-profile/bun-profile  UNSTRIPPED (547 MB).
  `llvm-nm-21 --size-sort --print-size --radix=d --demangle <it>` works.
  PRE-DUMPED at /tmp/canary/nm-dem.txt (demangled) and /tmp/canary/nm.txt
  (mangled). 80,291 symbols. USE nm-dem.txt.
- /tmp/canary/bun-linux-x64-profile/bun-profile.linker-map  the REAL LTO
  map. CAVEAT: full LTO collapses most attribution into one lto.o, so
  per-COMPONENT attribution needs the LOCAL non-LTO map; the canary map
  still correctly attributes the non-bitcode inputs (icudata 11.04 MB).
Sections: the canary's .text is 52.31 MB, .rodata 20.62 MB. Full LTO GREW
.text by ~3.5 MB over a non-LTO build (inlining) and collapsed .data.rel.ro.

## THE CENSUS (per-subsystem, all 80,291 canary symbols; .text in MB)
JSC-core 8.94 | rust:bun_runtime 3.70 | WebCore 2.94 | JSC::DFG 2.88 |
rust:core/alloc/std 2.69 | rust:bun_css 2.07 | WTF 1.80 |
rust:bun_js_parser 1.45 | JSC::Wasm 1.35 | rust:bun_install 1.35 |
ICU-CODE(icu_75::) 1.12 | rust:bun_react_compiler 0.88 | JSC::FTL 0.86 |
sqlite3 0.80 | JSC::B3 0.66 | JSC::B3::Air 0.62 | rust:bun_js_printer 0.58 |
JSC::Yarr 0.57 | rust:bun_jsc 0.56 | zstd 0.51
.rodata (beyond the 11 MB icu blob): Bun(the embedded JS) 1.80 | WebCore
0.43 | brotli(the ENCODER dict hash tables) 0.40 | PAL(text codec tables,
LOAD-BEARING: every WHATWG TextDecoder label works on the canary) 0.31 |
JSC::Yarr(two 64KB-for-88-bits tables) 0.26 | boringssl 0.25 |
rust:encoding_rs 0.13
NOTABLE: `bun_react_compiler` (0.88 MB) is a real, documented, opt-in
feature (`bun build --react-compiler`), NOT removable. The ICU *CODE*
(icu_75:: namespace, 1.12 MB, distinct from the ICU DATA) has ~0.15-0.3 MB
of provably-JS-unreachable classes (MessageFormat, the collation-rule
COMPILER, RuleBasedNumberFormat, Region) kept alive only by ICU's internal
registries; the removal site is the UCONFIG_NO_* macros in oven-sh/WebKit's
ICU build (the orchestrator has WRITE access there).

## For every proposal, your REPORT must state
saving_mb (DERIVED from /tmp/canary/nm-dem.txt, with the derivation),
confidence, risk, perf (neutral|improvement|one-time-lazy(which path)|
REGRESSION(what) -- anything marked REGRESSION goes to dead_ends),
regression (precise), windows (yes|no|why), the exact files to change,
effort (small|medium|large), and whether it is measurable by a RELINK ONLY
(minutes) vs a full rebuild (40+ minutes, serialized).
Honesty over volume. The remaining need is only 4.86 MB on linux and
2.00 MB on windows; small, certain, zero-regression wins are worth MORE
than large speculative ones. Rank accordingly.
