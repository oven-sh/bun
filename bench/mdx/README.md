# MDX compiler benchmark

This benchmark compares native `Bun.mdx.compile` with `@mdx-js/mdx` 3.1.1, including GFM and YAML frontmatter support. It measures compilation from an in-memory string. It does not measure application rendering, bundling, file loading, or network requests.

The HTML harness below measures rendering separately. Keep generated reports, CSV files, and raw measurement archives outside the source tree.

Install the pinned dependency tree with `npm ci --ignore-scripts --prefix bench/mdx` from the repository root. Supply a JSON manifest with entries shaped like `{ "id": "example", "label": "Example document", "path": "./example.mdx" }`. Paths resolve relative to the manifest. An empty array runs only the generated ASCII and Unicode controls, approximately 1, 10, and 100 KB each.

Run from the repository root:

```sh
bun bd bench/mdx/check.mjs /absolute/path/manifest.json

MDX_BENCH_MANIFEST=/absolute/path/manifest.json \
MDX_BENCH_OUTPUT=/absolute/path/results \
MDX_BENCH_PREVIOUS=/absolute/path/previous-release-bun \
bun run build:release bench/mdx/run.mjs

node bench/mdx/summarize.mjs /absolute/path/results
```

`MDX_BENCH_NODE` selects a Node executable. `MDX_BENCH_DEPS` optionally points to another directory containing the pinned dependencies. The benchmark launches child processes using the release build selected by the build script. Run it after other builds and tests finish.

The main comparison runs both compilers on the same Bun executable. The reference compiler also runs on Node and the previous Bun release. Each reference compiler reuses a `createProcessor` instance. Native JSX lowering reuses a `Bun.Transpiler` instance. Both compilers use production mode; GFM links and table alignment attributes are enabled. The frontmatter plugins run for documents with a YAML header.

Two output stages are measured separately:

- MDX to JSX: native `Bun.mdx.compile` versus the reference compiler with `jsx: true`.
- MDX to JavaScript: native compilation followed by `Bun.Transpiler.transformSync`, versus the reference compiler with `jsx: false`.

Warm measurements use three fresh process rounds, deterministic shuffled engine/stage and document order, at least 20 warmup calls and 150 ms of warmup per case, and 40 timed batches per case per round. Calibration targets 20 ms per batch. Generated output lengths are consumed in every timed iteration. Results retain every batch duration and iteration count. The summary takes each round's median time per compile, then the median of those three medians. The aggregate is the geometric mean of document speedup ratios; synthetic controls are excluded from that aggregate.

Fresh-process measurements use ten processes per engine for three representative documents and measure MDX to JSX. The internal timer includes compiler module imports, processor construction, and the first compile. The outer timer additionally includes process startup, harness execution, fixture loading, and process exit. These are fresh processes with a warm OS file cache, not cold-disk measurements.

Input documents are never copied into the results. Results contain anonymous labels supplied by the manifest, byte sizes, SHA-256 hashes, runtime versions, hardware metadata, and measurements. Check output compatibility before selecting a corpus and disclose adaptations and exclusions alongside any published numbers. Different compilers can produce different component behavior even when their Markdown content trees agree.

`check.mjs` parses both generated JSX modules and compares normalized content trees, imports, and named exports. It collapses text whitespace outside code blocks, ignores formatting-only whitespace nodes, normalizes compiler component names, and compares attributes by name. It compares the generated YAML frontmatter declaration separately from user export order. It does not execute imported components or establish full runtime or initialization-order equivalence. Its output contains hashes and difference locations without source text.

## HTML output

For trusted MDX documents that need no application imports or custom components, `html.mjs` compares a complete in-memory MDX to HTML pipeline. Each iteration compiles MDX to JSX, bundles that JSX to CommonJS with `Bun.build` while keeping React external, evaluates the generated module, and calls React's `renderToStaticMarkup`. Both compilers use the same bundler and React version. A separate render-only control reuses an already compiled and evaluated component. The harness checks normalized parsed HTML before timing and rejects output that changes during measurement.

```sh
NODE_ENV=production \
MDX_BENCH_MANIFEST=/absolute/path/html-manifest.json \
MDX_BENCH_OUTPUT=/absolute/path/results \
bun run build:release bench/mdx/html.mjs

node bench/mdx/summarize-html.mjs /absolute/path/results
```

This pipeline executes the supplied MDX, so use trusted input without application imports or custom components. It supports GFM and measures a specific compile-and-render pipeline, not a full framework request or a browser page load. Declare the HTML corpus separately when it differs from the compilation corpus.

The `native-fast` engine first tries `tryRenderStaticMdx` from `static-html.mjs`. This benchmark helper accepts a limited static subset: Markdown with bare `<br />` tags, without expressions, module declarations, frontmatter, images, or other JSX. Accepted inputs are parsed and rendered afresh by `Bun.markdown.html`; other inputs use the full native compilation and React pipeline. The helper is not a new `Bun.mdx` API. The same normalized HTML preflight applies to all three engines. It does not establish byte equality or arbitrary MDX runtime compatibility.

`html-fast-summary.json` reports the arithmetic mean of the three round means, giving each document equal weight. This is separate from the median-based full-pipeline speedup. Set `MDX_HTML_PREFLIGHT_ONLY=1` to run only the HTML compatibility check.

## Native before/after and whole-corpus checks

`corpus.mjs` compiles every manifest entry with native and reference compilers and checks the resulting JSX with `Bun.Transpiler`. It does not execute document modules. Its reports contain identifiers, sizes, hashes, success flags, and error classes. An optional `MDX_CORPUS_BASELINE` executable adds a previous native build to the check.

```sh
bun run build:release bench/mdx/corpus.mjs /absolute/path/manifest.json /absolute/path/corpus-results

MDX_CORPUS_BASELINE=/absolute/path/previous-native-bun \
MDX_COMPARE_CORPUS=/absolute/path/common-valid-manifest.json \
bun run build:release bench/mdx/compare.mjs /absolute/path/benchmark-manifest.json /absolute/path/comparison

node bench/mdx/summarize-comparison.mjs /absolute/path/comparison
```

The before/after benchmark reuses the main harness's ASCII/Unicode controls and warm timing protocol. It alternates executable order across stages and rounds. The optional corpus timing runs three warmup passes and 21 measured passes in each of three processes per executable. Supply only documents that compile successfully in both builds for that timing manifest. File reads occur before timing, and every iteration consumes the output length. The summary retains each round's median and reports the median of those medians.
