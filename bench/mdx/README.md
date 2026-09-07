# MDX compiler benchmark

This benchmark compares native `Bun.mdx.compile` with `@mdx-js/mdx` 3.1.1, including GFM and YAML frontmatter support. It measures compilation from an in-memory string. It does not measure application rendering, bundling, file loading, or network requests.

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
