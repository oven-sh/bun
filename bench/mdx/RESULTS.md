# Native MDX: real-document benchmark

This report records the pre-optimization baseline. See [the subsequent optimization report](OPTIMIZATION.md) for native before/after timings, the expanded 3,551-document check, and the static HTML experiment.

Measured on September 7, 2026 UTC (September 6 locally). Native compiler source: [`89797b3a68`](https://github.com/benpsnyder/bun/commit/89797b3a686cef345cc778e75250bed86e22bd00). [Proposed Bun feature, PR #27047](https://github.com/oven-sh/bun/pull/27047).

Across six real sales and legal MDX documents, native compilation achieved a **57.43× geometric-mean speedup for MDX → JSX** and **24.81× for MDX → JavaScript**, compared with `@mdx-js/mdx` 3.1.1 on the same Bun release executable. These are warmed compiler measurements, not application rendering or complete build times.

## Main comparison

| Document | Input KB | Native JSX ms | Reference JSX ms | Speedup | Native JS ms | Reference JS ms | Speedup |
|---|---:|---:|---:|---:|---:|---:|---:|
| Sales opportunities | 22.3 | 0.218 | 17.839 | 81.7× | 0.679 | 18.503 | 27.3× |
| Sales review tracker | 26.6 | 0.264 | 31.846 | 120.6× | 0.869 | 33.731 | 38.8× |
| Master services agreement | 53.8 | 0.525 | 22.949 | 43.7× | 1.211 | 25.814 | 21.3× |
| Mutual NDA | 11.8 | 0.112 | 3.615 | 32.2× | 0.208 | 3.968 | 19.1× |
| Support contract | 54.1 | 0.484 | 24.836 | 51.3× | 1.244 | 27.628 | 22.2× |
| Partner agreement | 28.6 | 0.307 | 15.521 | 50.5× | 0.730 | 17.741 | 24.3× |

KB means 1,000 UTF-8 bytes. The corpus totals 197,174 bytes. Each cell is the median of three per-process medians, each based on 40 timed batches. The aggregate gives each document equal weight. Ratios use unrounded measurements.

## Runtime comparison

| Reference runtime | MDX → JSX speedup | MDX → JavaScript speedup |
|---|---:|---:|
| Same local Bun 1.4.3 release build | 57.43× | 24.81× |
| Node 26.8.1 | 59.43× | 25.04× |
| Installed Bun 1.4.1 | 57.55× | 23.56× |

Bun 1.4.1 has no native MDX API; its row measures the reference JavaScript compiler. This is a comparison between compilers, not a native-MDX before/after regression benchmark.

## Repeatability

- MDX → JSX: document speedups 32.2–120.6×; per-round geometric means 33.3×, 59.0×, 59.4×.
- MDX → JS: document speedups 19.1–38.8×; per-round geometric means 64.4×, 23.5×, 24.7×.

The first process round differed from later rounds, particularly for JavaScript output. All rounds are retained. The headline uses the predefined median-based summary, not the fastest round. This is one laptop running normal background applications; no builds, installs, or test suites ran concurrently with the benchmark.

## Inputs, adaptations, and exclusions

Twelve documents were selected for their subject matter and size before timing. Six passed the normalized content-tree check and formed the headline corpus. Both engines received exactly the same adapted source strings. The sales trackers were unchanged. The four included legal documents each had one type-only import and one variable type annotation removed for standard MDX compatibility. The master services agreement also had nine literal template-placeholder escape sequences repaired. Original documents were not edited.

The included legal documents exercise YAML frontmatter, ESM metadata exports, JSX components, JavaScript expressions, and Markdown. The sales trackers contain large GFM tables. Document labels are anonymous, and no private document source is included in the deliverables.

| Excluded candidate | Preflight reason |
|---|---|
| Master services draft | Text-whitespace output difference |
| Platform license | Emphasis output difference |
| Statement of work | Emphasis output difference |
| Customer agreement | Invalid JSX closing structure after normalization |
| Infrastructure proposal | Task-list class output difference |
| Service proposal | Text-whitespace output difference |

Selection was based on compatibility before timing. Excluded files did not contribute timings or ratios. The six synthetic controls also do not contribute to the headline. Private input hashes, sizes, adaptations, and candidate results are recorded in `corpus-preflight.json`; exact private inputs are not publicly reproducible.

The checker parses generated JSX, compares normalized content trees, preserves import and user-export order, and compares generated YAML frontmatter declarations separately. It collapses text whitespace outside code, ignores formatting-only whitespace nodes, and normalizes compiler component references and attribute ordering. Imported business components were not executed. This does not establish full runtime compatibility. Native frontmatter declaration placement differs from the reference plugin; the selected user exports do not reference `frontmatter`, and initialization-order equivalence is not claimed.

## Protocol

- Three fresh process rounds per engine/output stage; deterministic shuffled order of engines, stages, and documents.
- At least 20 warmup calls and 150 ms warmup for each case. Forty measured batches per round, calibrated toward 20 ms each; slow individual compiles use a one-iteration batch.
- Reference compiler: reused `createProcessor(...).processSync(source)`, not a new processor per timed call. `remark-gfm` 4.0.1 and YAML plugins 5.0.0/5.2.0 supply the matching features. Table alignment remains `align`, and native permissive autolinks are enabled.
- JSX stage preserves JSX on both sides. JavaScript stage uses native MDX compilation followed by a reused `Bun.Transpiler({ loader: "tsx", target: "browser" })`; the reference uses `jsx: false`.
- Every timed iteration consumes the output length. File I/O, correctness checking, warm compiler setup, and app rendering are outside the warm timing.
- Apple M5 Pro, 18 cores, 64 GB RAM, macOS 27.0 build 26A5421a. Standard Bun release profile, macOS 26.5 SDK, LLVM 21, Rust nightly 2026-07-20. No optimization or LTO tuning changes were made for the benchmark.

Timing window: 2026-09-07T02:02:30.312Z through 2026-09-07T02:23:21.665Z. The binary reports `1.4.3-canary.1+5dc72eadc` because the verified native fixes were committed immediately after building it; source and executable hashes are included.

## Fresh-process measurements

Ten fresh processes per row, MDX → JSX. The inner timer includes compiler module imports, processor setup, and the first compile. Process wall time additionally includes startup, harness/fixture loading, and exit. The OS file cache was not flushed. These measurements are separate from the warm headline.

| Document | Engine | Init + first compile ms | Process wall ms |
|---|---|---:|---:|
| Sales opportunities | Native Bun | 0.445 | 14.038 |
| Sales opportunities | MDX.js / same Bun | 72.357 | 87.206 |
| Sales opportunities | MDX.js / Node | 92.744 | 129.103 |
| Sales opportunities | MDX.js / Bun 1.4.1 | 72.267 | 86.419 |
| Master services agreement | Native Bun | 0.901 | 14.139 |
| Master services agreement | MDX.js / same Bun | 90.002 | 105.194 |
| Master services agreement | MDX.js / Node | 112.935 | 149.109 |
| Master services agreement | MDX.js / Bun 1.4.1 | 90.161 | 105.766 |
| Support contract | Native Bun | 0.839 | 14.379 |
| Support contract | MDX.js / same Bun | 96.447 | 111.914 |
| Support contract | MDX.js / Node | 118.783 | 155.206 |
| Support contract | MDX.js / Bun 1.4.1 | 97.013 | 111.738 |

## Synthetic controls

Repeated headings, emphasis, links, expressions, and GFM tables cover ASCII and Unicode strings at roughly 1, 10, and 100 KB. These are stress controls, not real-document results.

| Control | Bytes | Stage | Native ms | MDX.js / Bun ms | MDX.js / Node ms | MDX.js / Bun 1.4.1 ms |
|---|---:|---|---:|---:|---:|---:|
| synthetic-ascii-1024 | 1036 | JSX | 0.015 | 1.014 | 1.042 | 0.971 |
| synthetic-ascii-1024 | 1036 | JS | 0.054 | 1.187 | 1.110 | 1.074 |
| synthetic-ascii-10240 | 10360 | JSX | 0.118 | 11.573 | 12.362 | 12.305 |
| synthetic-ascii-10240 | 10360 | JS | 0.441 | 13.501 | 12.982 | 12.472 |
| synthetic-ascii-102400 | 102416 | JSX | 1.116 | 327.604 | 348.133 | 334.346 |
| synthetic-ascii-102400 | 102416 | JS | 4.296 | 348.311 | 355.166 | 345.881 |
| synthetic-unicode-1024 | 1113 | JSX | 0.019 | 1.020 | 1.076 | 1.030 |
| synthetic-unicode-1024 | 1113 | JS | 0.067 | 1.136 | 1.157 | 1.163 |
| synthetic-unicode-10240 | 10335 | JSX | 0.136 | 11.849 | 11.448 | 11.515 |
| synthetic-unicode-10240 | 10335 | JS | 0.530 | 12.663 | 12.458 | 11.885 |
| synthetic-unicode-102400 | 102555 | JSX | 1.327 | 302.618 | 293.203 | 295.049 |
| synthetic-unicode-102400 | 102555 | JS | 5.096 | 310.238 | 292.717 | 304.425 |

## MDX to HTML: compile and render

The full in-memory pipeline measured **19.67×** geometric-mean speedup on **two unmodified sales documents**. Each iteration compiles MDX to JSX, bundles with `Bun.build`, evaluates the module, and renders static HTML with **React 19.2.8 in production mode**. Both compilers use the same Bun release executable, bundler, React renderer, and GFM options. This is a different corpus from the six-document compilation comparison.

| Sales document | Native pipeline ms | Reference pipeline ms | Pipeline speedup | Native render-only ms | Reference render-only ms |
|---|---:|---:|---:|---:|---:|
| Sales opportunities | 1.260 | 21.247 | 16.87× | 0.101 | 0.105 |
| Sales review tracker | 1.480 | 33.938 | 22.93× | 0.116 | 0.122 |

Rendering already compiled components measured **1.048×**. Thus the large pipeline improvement comes from compilation, not a 19.7× faster React renderer. The three pipeline round geometric means were 17.60×, 19.00×, 21.72×.

The rendered HTML passed a parsed-DOM comparison after whitespace normalization. Output byte sizes differ by 12 bytes and 1 byte respectively, so byte-for-byte equality is not claimed. Source hashes match the unmodified sales inputs used in the compilation benchmark. No application-specific components or imports were used. HTML was checked before timing, and every measurement worker checked stable output afterward.

The HTML run uses three fresh process rounds, 40 batches per document/mode/engine, at least 20 calls and 150 ms warmup, and batch calibration toward 20 ms. File reads, initial React imports, and HTML preflight are outside timing. Unlike the compiler-only tests, bundling, module evaluation, and React SSR are inside the full-pipeline timer. The render-only timer includes only the precompiled component render.

HTML binary revision: `89797b3a686cef345cc778e75250bed86e22bd00`. Compiler source remains `89797b3a686cef345cc778e75250bed86e22bd00`; the rebuild updates its embedded revision. `html-protocol.json` records the executable and harness hashes.

The compilation poster and the additional HTML poster are delivered separately from this source benchmark.

## Correctness and reproduction

Real-document preflight exposed and led to fixes for per-table alignment, unwanted paragraph wrappers around standalone MDX content, and missing protocols in autolinks. Regression cases failed on the unfixed branch. Final debug verification: **1,169 passed, 1 platform skip, 0 failed** across the seven Markdown files and build post-link tests. All **12 Rust target checks passed**. System Bun rejected all 14 selected MDX cases because the feature is absent; the table-alignment regression also fails on system Bun. The release build completed its smoke and duplicate-symbol checks.

The reusable harness and checker are in `bench/mdx/`. The pinned lockfile installs successfully with `npm ci --ignore-scripts --offline`. Use a compatible local manifest to rerun a corpus; an empty array runs public synthetic controls. See the harness README for commands. Full batch timings, runtime metadata, hashes, adaptation records, and summaries are in [results/data.tar.gz](results/data.tar.gz). Unpack it and pass that directory to `summarize.mjs` and `summarize-html.mjs`. CSV summaries: [compilation](results/compilation.csv), [HTML](results/html.csv).

The compilation graphic rounds 57.42965× down to 57×; JavaScript output is 24.8×. The HTML poster shows 19.7× for the full pipeline and a 1.05× render-only control.

Sources: [MDX compiler API](https://mdxjs.com/packages/mdx/#compileoptions), [GFM plugin](https://github.com/remarkjs/remark-gfm), [MDX frontmatter plugin](https://github.com/remcohaszing/remark-mdx-frontmatter).
