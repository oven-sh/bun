/**
 * A coarse comparison of two bun binaries on the same work. The machine may be shared and loaded: every case
 * is run N times per binary, interleaved, and the MINIMUM and the median of wall and CPU time are reported
 * (the minimum is the run least disturbed by other jobs).
 *
 *   bun image/bench.ts <out.json> <label>=<binary> <label>=<binary>
 *
 * The scripts that the binaries run are written to <out.json>.work/. The transpiler case reads
 * $BENCH_TRANSPILE_INPUT, by default node_modules/typescript/lib/typescript.js of the repository.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPOSITORY } from "../flags.ts";

const [outPath, ...binaries] = process.argv.slice(2);
if (outPath === undefined || binaries.length === 0) {
  console.error("usage: bun image/bench.ts <out.json> <label>=<binary> [<label>=<binary>]");
  process.exit(2);
}
const labels = binaries.map(b => ({ label: b.slice(0, b.indexOf("=")), binary: resolve(b.slice(b.indexOf("=") + 1)) }));
const dir = `${resolve(outPath)}.work`;
mkdirSync(dir, { recursive: true });
const typescriptJs =
  process.env.BENCH_TRANSPILE_INPUT ?? join(REPOSITORY, "node_modules", "typescript", "lib", "typescript.js");
if (!existsSync(typescriptJs)) {
  console.error(
    `${typescriptJs} is not there: run bun install in the repository, or set BENCH_TRANSPILE_INPUT to a large JavaScript file`,
  );
  process.exit(2);
}

writeFileSync(
  join(dir, "transpile.ts"),
  `const source = await Bun.file(${JSON.stringify(typescriptJs)}).text();
const t = new Bun.Transpiler({ loader: "js" });
let n = 0;
for (let i = 0; i < 3; i++) n += t.transformSync(source).length;
console.log(n);
`,
);
writeFileSync(
  join(dir, "http.ts"),
  `const server = Bun.serve({ port: 0, fetch: () => new Response("x".repeat(16384)) });
let bytes = 0;
for (let i = 0; i < 3000; i++) bytes += (await (await fetch("http://127.0.0.1:" + server.port)).arrayBuffer()).byteLength;
await server.stop(true);
console.log(bytes);
`,
);
writeFileSync(
  join(dir, "buffers.ts"),
  `// copies and compares of many sizes: the libc memory functions
const big = Buffer.alloc(8 << 20, 1);
let sum = 0;
for (let round = 0; round < 40; round++) {
  const copy = Buffer.from(big);
  sum += copy.length + (copy.equals(big) ? 1 : 0);
  for (let size = 16; size <= 65536; size *= 4) {
    for (let i = 0; i < 2000; i++) sum += Buffer.from(big.subarray(i, i + size)).length;
  }
}
const s = "portable ".repeat(100000);
for (let i = 0; i < 50; i++) sum += (s + i).length + Buffer.from(s).toString("utf8").length;
console.log(sum);
`,
);
writeFileSync(
  join(dir, "json-gc.ts"),
  `const data = Array.from({ length: 200000 }, (_, i) => ({ id: i, name: "item" + i, tags: ["a", "b", String(i % 10)], nested: { x: i / 3 } }));
let n = 0;
for (let i = 0; i < 5; i++) n += JSON.parse(JSON.stringify(data)).length;
console.log(n);
`,
);

const cases: { name: string; args: string[]; runs: number }[] = [
  { name: "start: --version", args: ["--version"], runs: 40 },
  { name: "start: -e 1", args: ["-e", "1"], runs: 40 },
  { name: "transpile typescript.js x3", args: [join(dir, "transpile.ts")], runs: 9 },
  { name: "http: 3000 fetches of 16 KiB from Bun.serve", args: [join(dir, "http.ts")], runs: 9 },
  { name: "buffers: copies and compares", args: [join(dir, "buffers.ts")], runs: 9 },
  { name: "json + gc", args: [join(dir, "json-gc.ts")], runs: 9 },
];

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
const results = [];
for (const c of cases) {
  const wall: Record<string, number[]> = {};
  const cpu: Record<string, number[]> = {};
  const rss: Record<string, number[]> = {};
  const outputs: Record<string, string> = {};
  for (let run = 0; run < c.runs; run++) {
    for (const { label, binary } of labels) {
      const started = performance.now();
      const r = Bun.spawnSync([binary, ...c.args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1" },
      });
      const elapsed = performance.now() - started;
      if (r.exitCode !== 0) throw new Error(`${label} ${c.name}: exit ${r.exitCode}: ${r.stderr.toString()}`);
      (wall[label] ??= []).push(elapsed);
      (cpu[label] ??= []).push(Number(r.resourceUsage.cpuTime.total) / 1000);
      (rss[label] ??= []).push(r.resourceUsage.maxRSS);
      outputs[label] = r.stdout.toString().trim();
    }
  }
  const row: Record<string, unknown> = { case: c.name, runs: c.runs };
  for (const { label } of labels) {
    row[label] = {
      wall_ms_min: +Math.min(...wall[label]!).toFixed(2),
      wall_ms_median: +median(wall[label]!).toFixed(2),
      cpu_ms_min: +Math.min(...cpu[label]!).toFixed(2),
      cpu_ms_median: +median(cpu[label]!).toFixed(2),
      max_rss_mb_median: +(median(rss[label]!) / (1 << 20)).toFixed(1),
    };
  }
  const [a, b] = labels;
  if (a && b) {
    row.same_output = outputs[a.label] === outputs[b.label] || c.name.startsWith("start: --version");
    row[`${a.label}_over_${b.label}`] = {
      wall_min: +(Math.min(...wall[a.label]!) / Math.min(...wall[b.label]!)).toFixed(3),
      cpu_min: +(Math.min(...cpu[a.label]!) / Math.min(...cpu[b.label]!)).toFixed(3),
    };
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(outPath, JSON.stringify({ loadavg: require("node:os").loadavg(), results }, null, 1) + "\n");
