# MDX optimization results

Measured September 7, 2026 UTC. Native source: [`c39cad2151`](https://github.com/benpsnyder/bun/commit/c39cad2151bd4b9d634fdc5809ac6529ceaca08a). [PR #27047](https://github.com/oven-sh/bun/pull/27047).

The static-document HTML path averaged **155.35 μs per render** across the two original HTML benchmark documents. Each iteration parses the source and produces a fresh HTML string, with no output or component cache. This result meets the 200 μs target for this static subset. The full MDX compilation, module evaluation, and React pipeline is measured separately below.

## HTML rendering

| Document             | Static path mean μs | Full native pipeline median μs | Full reference pipeline median μs |
| -------------------- | ------------------: | -----------------------------: | --------------------------------: |
| Sales review tracker |              167.50 |                        1210.45 |                          31575.90 |
| Sales opportunities  |              143.20 |                        1014.51 |                          19126.66 |

The two inputs are unmodified, 22,310 and 26,582 UTF-8 bytes. They contain Markdown, GFM tables, and bare `<br />` tags. The mean gives each document equal weight and averages the three per-process round means. The full-pipeline columns use the median of three per-process medians, so the statistics are intentionally labeled separately.

`tryRenderStaticMdx` in `bench/mdx/static-html.mjs` is a benchmark pipeline helper, not a new `Bun.mdx` API. It accepts a limited static subset and calls `Bun.markdown.html` on every invocation. It rejects expressions, module declarations, frontmatter, images, other JSX, and selected URL forms; the harness then uses the full native MDX pipeline. Dynamic MDX and custom components do not have a demonstrated 200 μs result.

All three engines passed normalized parsed-HTML checks on both documents. Two additional expression/JSX fixtures exercised the full-pipeline fallback and also matched the reference. Byte equality is not claimed: formatting whitespace differs. The checker preserves whitespace in code and preformatted blocks. No application-specific components or imports were evaluated.

The full-pipeline geometric-mean speedup is **22.177×** against the reference compiler on the same Bun executable. The render-only control is **0.996×**.

The full pipeline compiles MDX to JSX, bundles a virtual module with `Bun.build` (`write: false`, React external), evaluates it, and calls React 19.2.8 production `renderToStaticMarkup`. Inputs and dependencies are loaded before timing. The separate render-only control reuses a compiled component and must not be confused with fresh MDX rendering.

## Native compiler before and after

The six portable document fixtures from the [earlier report](RESULTS.md) improved by **1.575× for MDX → JSX** and **1.172× for MDX → JavaScript**, using geometric means of per-document ratios. The legal fixtures retain the explicitly documented standard-MDX adaptations from that report; the sales inputs are unchanged.

| Document                  | Stage | Before μs | After μs | Speedup |
| ------------------------- | ----- | --------: | -------: | ------: |
| Sales review tracker      | JSX   |    248.40 |   147.01 |  1.690× |
| Mutual NDA                | JSX   |    109.79 |    63.75 |  1.722× |
| Partner agreement         | JSX   |    296.53 |   207.91 |  1.426× |
| Support contract          | JSX   |    467.67 |   338.52 |  1.382× |
| Sales opportunities       | JSX   |    207.53 |   124.11 |  1.672× |
| Master services agreement | JSX   |    506.40 |   318.19 |  1.592× |
| Sales review tracker      | JS    |    847.19 |   782.03 |  1.083× |
| Mutual NDA                | JS    |    208.72 |   159.85 |  1.306× |
| Partner agreement         | JS    |    736.21 |   658.38 |  1.118× |
| Support contract          | JS    |   1215.36 |  1055.96 |  1.151× |
| Sales opportunities       | JS    |    680.71 |   577.60 |  1.179× |
| Master services agreement | JS    |   1126.22 |   930.21 |  1.211× |

Across **3,456 unchanged corpus documents valid in both builds**, one complete compilation pass fell from **235.648 ms to 159.803 ms**, a **1.475× speedup**. This measures MDX-to-JSX compilation, not HTML rendering. The eight newly valid documents are excluded from this before/after timing because the previous build cannot compile them successfully.

The baseline executable contains native source `89797b3a686cef345cc778e75250bed86e22bd00`, unchanged through the preceding branch head `5b2cf68fb7636c11cfc52f7f75e13009a8e63fb3`. Both binaries use the standard release profile. This is a native before/after comparison. Earlier comparisons with the JavaScript compiler on Bun, Node 26.8.1, and installed Bun 1.4.1 remain in [RESULTS.md](RESULTS.md); their ratios are not multiplied by the new results to claim a freshly measured reference-compiler speedup.

### ASCII and Unicode controls

| Control                  | Stage | Before μs | After μs | Speedup |
| ------------------------ | ----- | --------: | -------: | ------: |
| synthetic-ascii-102400   | JSX   |   1071.75 |   987.19 |  1.086× |
| synthetic-ascii-1024     | JSX   |     14.64 |    13.48 |  1.086× |
| synthetic-unicode-1024   | JSX   |     18.13 |    14.74 |  1.230× |
| synthetic-unicode-10240  | JSX   |    131.88 |   103.80 |  1.270× |
| synthetic-unicode-102400 | JSX   |   1272.82 |   989.95 |  1.286× |
| synthetic-ascii-10240    | JSX   |    115.48 |   101.87 |  1.134× |
| synthetic-ascii-102400   | JS    |   4278.28 |  4174.65 |  1.025× |
| synthetic-ascii-1024     | JS    |     53.75 |    52.55 |  1.023× |
| synthetic-unicode-1024   | JS    |     64.94 |    61.83 |  1.050× |
| synthetic-unicode-10240  | JS    |    500.47 |   481.61 |  1.039× |
| synthetic-unicode-102400 | JS    |   4947.73 |  4619.72 |  1.071× |
| synthetic-ascii-10240    | JS    |    430.53 |   415.56 |  1.036× |

The smallest measured speedup across all 24 cases was 1.023×. Every case improved in this run; this does not guarantee a speedup on every input or machine. All process rounds and batch measurements are retained, including slower rounds.

## All 3,551 documents

The complete corpus contains **3,551 files**, **26,084,724 UTF-8 bytes**, and **3,550 distinct contents**. Every file was checked without source adaptation. Input IDs and SHA-256 hashes match across the baseline, final native, and reference runs. Private paths and source text are not published.

| Syntax check                                                        | Result |
| ------------------------------------------------------------------- | -----: |
| Native compiler returned JSX                                        |  3,510 |
| Native output accepted by `Bun.Transpiler`                          |  3,464 |
| Reference compiler output accepted by `Bun.Transpiler`              |  3,275 |
| Newly valid native documents                                        |      8 |
| Previously valid native documents that became invalid               |      0 |
| Reference-valid documents rejected by native compilation/validation |      0 |
| Documents invalid in both pipelines                                 |     87 |

Of the 87 remaining native failures, 41 throw during MDX compilation and 46 produce JSX rejected by the transpiler. The reference also rejects these inputs. Native acceptance of additional documents does not establish standard-MDX equivalence.

The normalized content-tree checker reports **2,891 matches**, **384 differences**, and **276 inputs not compared because of compiler/parser errors**. Every reference-valid document reaches this comparison. Remaining differences include emphasis, whitespace, and task-list attributes. This checker compares content, imports, named exports, and frontmatter declarations; it does not execute business modules, imported components, or export initialization. Full runtime compatibility is not claimed.

## Changes and verification

Profiling identified byte-at-a-time JSX escaping, expression restoration, preprocessing copies, and string conversion as expensive work. The implementation writes literal chunks in bulk, uses existing SIMD search helpers, borrows unchanged preprocessing input, avoids unnecessary JavaScript fragment-parser initialization, and transfers the compiled UTF-8 buffer through Bun's existing owned-string conversion. Documents without either module keyword skip module-block scanning; 2,797 corpus documents take that path.

The expanded corpus exposed eight native parsing failures. Fixes preserve `import`/`export` prose in paragraph continuations, keep literal braces in Markdown link destinations, and respect blank-line and table-cell boundaries when identifying inline code. Link and table parsing now share their existing native grammar helpers. The initial copy/escaping optimization and the final module-scan guard each preserved all 3,551 corpus result objects at their respective checkpoints, including output hashes and failure states.

Validation used a macOS arm64 debug + ASAN build. These are separate, overlapping runs:

- `bun bd test test/js/bun/md`: **1,208 passed**, 0 failed, 1,994 assertions across seven files.
- MDX and bundler-plugin suites with `BUN_JSC_validateExceptionChecks=1`: **204 passed**, 3 existing TODOs, 0 failed.
- `bun run rust:check-all`: **12 targets passed**, 0 failed or skipped. These are compile checks, not runtime tests on every platform.
- Fourteen focused cases fail on the pre-optimization native build and pass on the updated debug build. Seven selected cases fail on installed Bun because its native MDX API is absent.
- Five checker fixtures cover generated-name collisions, single headings, empty documents, exports-only documents, and prose containing internal names. They all match after correcting the checker's generated-name lookup and transparent root-fragment normalization.

## Protocol and raw data

Apple M5 Pro, 18 cores, 64 GB RAM, macOS 27.0; macOS 26.5 SDK, LLVM 21, Rust nightly 2026-07-20. No optimization-level or LTO changes. Normal desktop applications remained open; no builds, installs, or test suites ran alongside measured benchmark workers.

Per-document measurements use three fresh processes per engine/stage, at least 20 calls and 150 ms warmup, and 40 timed batches calibrated toward 20 ms. Native before/after order alternates. Whole-corpus measurements use three warmup passes and 21 measured passes in each of three processes per binary. File reads and correctness checks occur outside timing. Every timed iteration consumes output length. Medians and arithmetic means are labeled above; all raw rounds are retained.

See [README.md](README.md) for reproduction commands. [Raw data and metadata](results/optimization-data.tar.gz), [native comparison CSV](results/optimization.csv), and [HTML CSV](results/optimization-html.csv) contain anonymous results and hashes. The private corpus is not distributed; the harness accepts a local manifest and includes public synthetic controls. The earlier posters and baseline report retain their original measurements.
