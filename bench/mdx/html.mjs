import { tryRenderStaticMdx } from "./static-html.mjs";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

if (process.env.NODE_ENV !== "production") throw new Error("Run the HTML benchmark with NODE_ENV=production");

const manifestPath = resolve(process.env.MDX_BENCH_MANIFEST || process.argv[2] || "manifest.json");
const outDir = resolve(process.env.MDX_BENCH_OUTPUT || "mdx-benchmark-results");
const deps = createRequire(join(resolve(process.env.MDX_BENCH_DEPS || import.meta.dirname), "package.json"));
const [{ createProcessor }, { default: gfm }, React, { renderToStaticMarkup }, { parseFragment }] = await Promise.all(
  ["@mdx-js/mdx", "remark-gfm", "react", "react-dom/server", "parse5"].map(
    name => import(pathToFileURL(deps.resolve(name)).href),
  ),
);
const fixtures = JSON.parse(readFileSync(manifestPath, "utf8")).map(fixture => ({
  ...fixture,
  source: readFileSync(resolve(dirname(manifestPath), fixture.path), "utf8"),
}));
const reference = createProcessor({
  jsx: true,
  development: false,
  tableCellAlignToStyle: false,
  remarkPlugins: [gfm],
});
const options = { permissiveAutolinks: true };
function native(source) {
  return Bun.mdx.compile(source, options);
}
function compileReference(source) {
  return String(reference.processSync(source));
}
async function component(source, engine) {
  const jsx = (engine === "reference" ? compileReference : native)(source);
  const result = await Bun.build({
    entrypoints: ["benchmark:document"],
    target: "node",
    format: "cjs",
    write: false,
    sourcemap: "none",
    external: ["react", "react/jsx-runtime"],
    plugins: [
      {
        name: "benchmark-document",
        setup(build) {
          build.onResolve({ filter: /^benchmark:document$/ }, () => ({ path: "document", namespace: "benchmark" }));
          build.onLoad({ filter: /.*/, namespace: "benchmark" }, () => ({ contents: jsx, loader: "jsx" }));
        },
      },
    ],
  });
  if (!result.success || result.outputs.length !== 1) throw new Error("HTML benchmark bundling failed");
  const code = await result.outputs[0].text();
  const module = { exports: {} };
  const requireRuntime = name => {
    if (name !== "react" && name !== "react/jsx-runtime")
      throw new Error("HTML corpus must not import application modules");
    return deps(name);
  };
  new Function("require", "module", "exports", code)(requireRuntime, module, module.exports);
  return module.exports.default;
}
const render = Component => renderToStaticMarkup(React.createElement(Component));
async function renderHtml(source, engine) {
  if (engine === "native-fast") {
    const html = tryRenderStaticMdx(source);
    if (html !== null) return html;
  }
  return render(await component(source, engine));
}
function canonical(node, preserve = false) {
  if (node.nodeName === "#text") {
    if (preserve) return node.value;
    const value = node.value.replace(/\s+/g, " ");
    return value.trim() ? value : null;
  }
  const childNodes = (node.childNodes || [])
    .map(child => canonical(child, preserve || node.tagName === "pre" || node.tagName === "code"))
    .filter(value => value !== null);
  return {
    tag: node.tagName || node.nodeName,
    attrs: (node.attrs || []).map(({ name, value }) => [name, value]).sort((a, b) => a[0].localeCompare(b[0])),
    children: childNodes,
  };
}
function shuffle(values, seed) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
if (process.env.MDX_HTML_WORKER) {
  const [engine, mode, round] = JSON.parse(process.env.MDX_HTML_WORKER);
  const results = [];
  let checksum = 0;
  for (const fixture of shuffle(fixtures, 7171 + round)) {
    const Component = mode === "render-only" ? await component(fixture.source, engine) : undefined;
    const run = mode === "html" ? () => renderHtml(fixture.source, engine) : async () => render(Component);
    const expected = await run();
    let count = 0;
    const warmStart = performance.now();
    do {
      checksum += (await run()).length;
      count++;
    } while (count < 20 || performance.now() - warmStart < 150);
    let batch = 1;
    while (true) {
      const start = performance.now();
      for (let i = 0; i < batch; i++) checksum += (await run()).length;
      const elapsed = performance.now() - start;
      if (elapsed >= 20 || batch >= 65536) break;
      batch = Math.min(65536, Math.max(batch + 1, Math.ceil((batch * 20) / Math.max(elapsed, 0.001))));
    }
    const batchMs = [];
    for (let sample = 0; sample < 40; sample++) {
      const start = performance.now();
      for (let i = 0; i < batch; i++) checksum += (await run()).length;
      batchMs.push(performance.now() - start);
    }
    const output = await run();
    if (output !== expected) throw new Error("HTML output changed during measurement");
    results.push({
      id: fixture.id,
      batch,
      batchMs,
      outputBytes: Buffer.byteLength(output),
      outputSha256: createHash("sha256").update(output).digest("hex"),
    });
  }
  process.stdout.write(JSON.stringify({ engine, mode, round, runtime: process.versions, checksum, results }));
} else {
  mkdirSync(outDir, { recursive: true });
  const preflight = [];
  for (const fixture of fixtures) {
    const html = {};
    for (const engine of ["native", "native-fast", "reference"])
      html[engine] = await renderHtml(fixture.source, engine);
    const trees = Object.fromEntries(
      Object.entries(html).map(([engine, output]) => [engine, canonical(parseFragment(output))]),
    );
    const equal = Object.values(trees).every(tree => JSON.stringify(tree) === JSON.stringify(trees.reference));
    preflight.push({
      id: fixture.id,
      equal,
      staticFastPath: tryRenderStaticMdx(fixture.source) !== null,
      inputBytes: Buffer.byteLength(fixture.source),
      inputSha256: createHash("sha256").update(fixture.source).digest("hex"),
      outputBytes: Object.fromEntries(
        Object.entries(html).map(([engine, output]) => [engine, Buffer.byteLength(output)]),
      ),
    });
    if (!equal) throw new Error(`HTML output differs for ${fixture.id}`);
  }
  writeFileSync(join(outDir, "html-preflight.json"), JSON.stringify(preflight, null, 2) + "\n");
  if (process.env.MDX_HTML_PREFLIGHT_ONLY === "1") {
    console.log(JSON.stringify(preflight));
    process.exit(0);
  }
  const startedAt = new Date().toISOString();
  writeFileSync(
    join(outDir, "html-protocol.json"),
    JSON.stringify(
      {
        startedAt,
        rounds: 3,
        samples: 40,
        targetBatchMs: 20,
        warmup: "20 calls and at least 150 ms",
        nodeEnv: process.env.NODE_ENV,
        bunRevision: Bun.revision,
        runtime: process.versions,
        react: React.version,
        pipeline: [
          "MDX compilation",
          "Bun.build JSX to CommonJS with React external",
          "module evaluation",
          "React renderToStaticMarkup",
        ],
        nativeFast:
          "Fresh native Markdown parse and HTML render for a checked static MDX subset; otherwise the full native MDX/JSX/React pipeline. No output or component cache.",
        renderOnly: "Precompiled and evaluated component, same React renderer",
        sourceHash: createHash("sha256")
          .update(readFileSync(import.meta.filename))
          .digest("hex"),
        staticPathSourceHash: createHash("sha256")
          .update(readFileSync(join(import.meta.dirname, "static-html.mjs")))
          .digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
  const results = [];
  for (let round = 0; round < 3; round++) {
    for (const [engine, mode] of shuffle(
      [
        ...["native", "reference"].flatMap(engine => ["html", "render-only"].map(mode => [engine, mode])),
        ["native-fast", "html"],
      ],
      1317 + round,
    )) {
      console.error(`HTML round ${round + 1}/3: ${engine}, ${mode}`);
      const child = spawnSync(process.execPath, [import.meta.filename, manifestPath], {
        env: { ...process.env, MDX_HTML_WORKER: JSON.stringify([engine, mode, round]) },
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      if (child.status !== 0) throw new Error(`${engine}/${mode} failed: ${child.stderr}`);
      results.push(JSON.parse(child.stdout));
      writeFileSync(join(outDir, "html-raw.json"), JSON.stringify(results, null, 2) + "\n");
    }
  }
  writeFileSync(
    join(outDir, "html-completed.json"),
    JSON.stringify({ startedAt, completedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}
