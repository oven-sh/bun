import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { cpus, platform, release } from "node:os";

const manifestPath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const baseline = process.env.MDX_CORPUS_BASELINE;
if (!baseline) throw new Error("Set MDX_CORPUS_BASELINE to the previous native build");
const hash = value => createHash("sha256").update(value).digest("hex");
const mode = process.env.MDX_COMPARE_WORKER;

if (mode) {
  const sources = JSON.parse(readFileSync(manifestPath, "utf8")).map(entry => ({
    id: entry.id,
    source: readFileSync(resolve(dirname(manifestPath), entry.path), "utf8"),
  }));
  let checksum = 0;
  function compileCorpus() {
    for (const { source } of sources) checksum += Bun.mdx.compile(source, { permissiveAutolinks: true }).length;
  }
  for (let i = 0; i < 3; i++) compileCorpus();
  const corpusMs = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    compileCorpus();
    corpusMs.push(performance.now() - start);
  }
  process.stdout.write(
    JSON.stringify({
      engine: mode,
      revision: Bun.revision,
      checksum,
      corpusMs,
      cases: sources.map(({ id, source }) => ({ id, bytes: Buffer.byteLength(source), sha256: hash(source) })),
    }),
  );
} else {
  mkdirSync(output, { recursive: true });
  const protocol = {
    startedAt: new Date().toISOString(),
    rounds: 3,
    warmSamples: 40,
    corpusPasses: 21,
    hardware: { cpus: cpus().map(cpu => cpu.model), platform: platform(), release: release() },
    executables: Object.fromEntries(
      Object.entries({ before: baseline, after: process.execPath }).map(([name, path]) => [
        name,
        { sha256: hash(readFileSync(path)) },
      ]),
    ),
  };
  writeFileSync(join(output, "comparison-protocol.json"), JSON.stringify(protocol, null, 2) + "\n");
  const results = [];
  for (let round = 0; round < protocol.rounds; round++) {
    for (const stage of ["jsx", "js"]) {
      const order = (round + Number(stage === "js")) % 2 ? ["after", "before"] : ["before", "after"];
      for (const engine of order) {
        const executable = engine === "before" ? baseline : process.execPath;
        const child = spawnSync(executable, [join(import.meta.dirname, "run.mjs"), manifestPath], {
          env: {
            ...process.env,
            MDX_BENCH_MANIFEST: manifestPath,
            MDX_BENCH_WORKER: JSON.stringify(["native", stage, round, "warm"]),
          },
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        });
        if (child.status !== 0) throw new Error(`${engine}/${stage} failed: ${child.stderr}`);
        results.push({ ...JSON.parse(child.stdout), engine });
        writeFileSync(join(output, "comparison-raw.json"), JSON.stringify(results, null, 2) + "\n");
        console.log(`Round ${round + 1}: ${engine}, ${stage}`);
      }
    }
  }
  if (process.env.MDX_COMPARE_CORPUS) {
    const corpus = [];
    for (let round = 0; round < protocol.rounds; round++) {
      for (const engine of round % 2 ? ["after", "before"] : ["before", "after"]) {
        const child = spawnSync(
          engine === "before" ? baseline : process.execPath,
          [import.meta.filename, process.env.MDX_COMPARE_CORPUS, output],
          {
            env: { ...process.env, MDX_COMPARE_WORKER: engine },
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
          },
        );
        if (child.status !== 0) throw new Error(`${engine}/corpus failed: ${child.stderr}`);
        corpus.push({ ...JSON.parse(child.stdout), round });
        writeFileSync(join(output, "corpus-timing-raw.json"), JSON.stringify(corpus, null, 2) + "\n");
        console.log(`Corpus round ${round + 1}: ${engine}`);
      }
    }
  }
  protocol.completedAt = new Date().toISOString();
  writeFileSync(join(output, "comparison-protocol.json"), JSON.stringify(protocol, null, 2) + "\n");
}
