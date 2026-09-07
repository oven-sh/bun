import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const manifestPath = resolve(process.env.MDX_BENCH_MANIFEST || process.argv[2] || "manifest.json");
const outDir = resolve(process.env.MDX_BENCH_OUTPUT || "mdx-benchmark-results");
const deps = createRequire(join(resolve(process.env.MDX_BENCH_DEPS || import.meta.dirname), "package.json"));
const rounds = 3;
const samples = 40;
const targetBatchMs = 20;
const entries = JSON.parse(readFileSync(manifestPath, "utf8"));
const cases = entries.map(entry => ({
  ...entry,
  source: readFileSync(resolve(dirname(manifestPath), entry.path), "utf8"),
}));
for (const encoding of ["ascii", "unicode"]) {
  for (const size of [1024, 10240, 102400]) {
    const unit = `## ${encoding === "ascii" ? "Project overview" : "Project overview — 世界"}\n\nText with **emphasis**, [a link](https://example.com), and {props.value}.\n\n| Item | State |\n| :--- | ---: |\n| Review | Done |\n\n`;
    cases.push({
      id: `synthetic-${encoding}-${size}`,
      label: `${encoding} control ${size}`,
      synthetic: true,
      source: unit.repeat(Math.ceil(size / Buffer.byteLength(unit))),
    });
  }
}
function metadata(fixture) {
  return {
    id: fixture.id,
    label: fixture.label,
    synthetic: fixture.synthetic === true,
    bytes: Buffer.byteLength(fixture.source),
    sha256: createHash("sha256").update(fixture.source).digest("hex"),
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
async function compiler(engine, stage, source) {
  if (engine === "native") {
    const options = { permissiveAutolinks: true };
    if (stage === "jsx") return () => Bun.mdx.compile(source, options);
    const transpiler = new Bun.Transpiler({ loader: "tsx", target: "browser" });
    return () => transpiler.transformSync(Bun.mdx.compile(source, options));
  }
  const [{ createProcessor }, { default: gfm }, { default: frontmatter }, { default: mdxFrontmatter }] =
    await Promise.all(
      ["@mdx-js/mdx", "remark-gfm", "remark-frontmatter", "remark-mdx-frontmatter"].map(
        name => import(pathToFileURL(deps.resolve(name)).href),
      ),
    );
  const remarkPlugins = [gfm];
  if (/^---\r?\n/.test(source)) remarkPlugins.push(frontmatter, [mdxFrontmatter, { name: "frontmatter" }]);
  const processor = createProcessor({
    jsx: stage === "jsx",
    development: false,
    tableCellAlignToStyle: false,
    remarkPlugins,
  });
  return () => String(processor.processSync(source));
}

if (process.env.MDX_BENCH_WORKER) {
  const [engine, stage, round, mode, fixtureId] = JSON.parse(process.env.MDX_BENCH_WORKER);
  let checksum = 0;
  const result = [];
  for (const fixture of shuffle(cases, 9371 + round * 101).filter(f => !fixtureId || f.id === fixtureId)) {
    const initStart = performance.now();
    const compile = await compiler(engine, stage, fixture.source);
    if (mode === "cold") {
      checksum += compile().length;
      result.push({ id: fixture.id, initAndFirstCompileMs: performance.now() - initStart });
      continue;
    }
    let count = 0;
    const warmStart = performance.now();
    do {
      checksum += compile().length;
      count++;
    } while (count < 20 || performance.now() - warmStart < 150);
    let batch = 1;
    while (true) {
      const start = performance.now();
      for (let i = 0; i < batch; i++) checksum += compile().length;
      const elapsed = performance.now() - start;
      if (elapsed >= targetBatchMs || batch >= 65536) break;
      batch = Math.min(65536, Math.max(batch + 1, Math.ceil((batch * targetBatchMs) / Math.max(elapsed, 0.001))));
    }
    const batchMs = [];
    for (let sample = 0; sample < samples; sample++) {
      const start = performance.now();
      for (let i = 0; i < batch; i++) checksum += compile().length;
      batchMs.push(performance.now() - start);
    }
    result.push({ id: fixture.id, batch, batchMs, outputCharacters: compile().length });
  }
  process.stdout.write(JSON.stringify({ engine, stage, round, mode, runtime: process.versions, checksum, result }));
} else {
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const executables = {
    native: process.execPath,
    reference: process.execPath,
    node: process.env.MDX_BENCH_NODE || "node",
    previous: process.env.MDX_BENCH_PREVIOUS || "bun",
  };
  const protocol = {
    startedAt,
    rounds,
    samples,
    targetBatchMs,
    warmup: "20 calls and at least 150 ms",
    compilerReuse: true,
    stages: ["jsx", "js"],
    hardware: {
      cpus: cpus().map(({ model }) => model),
      totalmem: totalmem(),
      freemem: freemem(),
      platform: platform(),
      release: release(),
    },
    cases: cases.map(metadata),
  };
  writeFileSync(join(outDir, "protocol.json"), JSON.stringify(protocol, null, 2) + "\n");
  function run(engine, stage, round, mode, fixtureId) {
    const start = performance.now();
    const child = spawnSync(executables[engine], [import.meta.filename, manifestPath], {
      env: {
        ...process.env,
        MDX_BENCH_MANIFEST: manifestPath,
        MDX_BENCH_WORKER: JSON.stringify([engine, stage, round, mode, fixtureId]),
      },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const processWallMs = performance.now() - start;
    if (child.status !== 0) throw new Error(`${engine}/${stage}/${mode} failed: ${child.stderr}`);
    return { ...JSON.parse(child.stdout), processWallMs };
  }
  const warm = [];
  for (let round = 0; round < rounds; round++) {
    for (const [engine, stage] of shuffle(
      Object.keys(executables).flatMap(engine => ["jsx", "js"].map(stage => [engine, stage])),
      19531 + round,
    )) {
      console.error(`Warm round ${round + 1}/${rounds}: ${engine}, MDX to ${stage.toUpperCase()}`);
      warm.push(run(engine, stage, round, "warm"));
      writeFileSync(join(outDir, "warm-raw.json"), JSON.stringify(warm, null, 2) + "\n");
    }
  }
  const cold = [];
  const coldCases = [
    cases[0],
    cases.find(f => f.id === "master-services") || cases[1],
    cases.find(f => f.id === "support-contract") || cases[2],
  ].filter(Boolean);
  for (let round = 0; round < 10; round++) {
    for (const engine of shuffle(Object.keys(executables), 371 + round)) {
      for (const fixture of coldCases) cold.push(run(engine, "jsx", round, "cold", fixture.id));
    }
    console.error(`Fresh process round ${round + 1}/10 complete`);
    writeFileSync(join(outDir, "cold-raw.json"), JSON.stringify(cold, null, 2) + "\n");
  }
  writeFileSync(
    join(outDir, "completed.json"),
    JSON.stringify({ startedAt, completedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}
