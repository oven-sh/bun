// Process-level benchmarks: spawn each binary N times per workload, interleaved.
//   bun procs.ts <runs> [filter]
// env: BENCH_ROOT, BENCH_BINS (JSON {label: path}), BENCH_PAIRS (JSON [[variant, base], ...]),
//      BUN_SRC_ROOT (checkout with node_modules/typescript and bench/), BENCH_INSTALL_DIR (optional)
import { rmSync } from "node:fs";

const runs = Number(process.argv[2] ?? 20);
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const ROOT = process.env.BENCH_ROOT ?? "/tmp/bench";
const SRC = process.env.BUN_SRC_ROOT ?? "/workspace/bun";
const bins: Record<string, string> = JSON.parse(
  process.env.BENCH_BINS ??
    JSON.stringify({
      "lto-base": "/tmp/bins/bun-lto-base",
      "lto-linkoutl": "/tmp/bins/bun-lto-linkoutl",
      "lto-rustoutl": "/tmp/bins/bun-lto-rustoutl",
      "nolto-base": "/tmp/bins/bun-nolto-base",
      "nolto-rustoutl": "/tmp/bins/bun-nolto-rustoutl",
    }),
);
const pairs: [string, string][] = JSON.parse(
  process.env.BENCH_PAIRS ??
    JSON.stringify([
      ["lto-linkoutl", "lto-base"],
      ["lto-rustoutl", "lto-base"],
      ["nolto-rustoutl", "nolto-base"],
    ]),
);
const names = Object.keys(bins);

type Work = { name: string; args: string[]; cwd?: string; before?: () => void; env?: Record<string, string> };
const TS = process.env.BENCH_TS ?? SRC + "/node_modules/typescript/lib/typescript.js";
const works: Work[] = [
  { name: "startup: bun -e 0", args: ["-e", "0"] },
  { name: "startup: bun run hello.js", args: ["run", ROOT + "/fixtures/hello.js"] },
  { name: "build: typescript.js (9MB)", args: ["build", TS, "--outdir", ROOT + "/out", "--target=node"] },
  {
    name: "build: typescript.js --minify",
    args: ["build", TS, "--outdir", ROOT + "/out", "--target=node", "--minify"],
  },
  ...(process.env.BENCH_NO_DEPS_BUILD
    ? []
    : [
        {
          name: "build: babel+fastify+react-dom",
          args: ["build", SRC + "/bench/outliner/deps-entry.ts", "--outdir", ROOT + "/out2", "--target=bun"],
          cwd: SRC + "/bench",
        },
      ]),
  { name: "run: require(typescript) 9MB cjs", args: ["-e", `require(${JSON.stringify(TS)})`] },
  { name: "test: 2000 tests / 8000 expects", args: ["test", ROOT + "/fixtures/many.test.ts"], cwd: ROOT + "/fixtures" },
  ...(process.env.BENCH_INSTALL_DIR
    ? [
        {
          name: "install: pkgs from cache",
          args: ["install", "--frozen-lockfile", "--ignore-scripts"],
          cwd: process.env.BENCH_INSTALL_DIR,
          before: () => rmSync(process.env.BENCH_INSTALL_DIR + "/node_modules", { recursive: true, force: true }),
        },
      ]
    : []),
];

type Sample = { wall: number; cpu: number; rss: number };
const results: Record<string, Record<string, Sample[]>> = {};

async function runOne(bin: string, w: Work): Promise<Sample> {
  w.before?.();
  const t0 = Bun.nanoseconds();
  const proc = Bun.spawn({
    cmd: [bins[bin], ...w.args],
    cwd: w.cwd ?? ROOT,
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", ...(w.env ?? {}) },
  });
  const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
  const wall = Bun.nanoseconds() - t0;
  if (code !== 0) throw new Error(`${bin} ${w.name} exited ${code}: ${stderr.slice(0, 500)}`);
  const ru = proc.resourceUsage()!;
  return { wall, cpu: Number(ru.cpuTime.user + ru.cpuTime.system) * 1000, rss: Number(ru.maxRSS) };
}

const t0 = Date.now();
for (const w of works) {
  if (filter && !filter.test(w.name)) continue;
  for (const bin of names) await runOne(bin, w);
  for (let r = 0; r < runs; r++) {
    const order = names.map((_, i) => names[(i + r) % names.length]);
    for (const bin of order) ((results[w.name] ??= {})[bin] ??= []).push(await runOne(bin, w));
  }
  process.stderr.write(`${w.name} done (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}
await Bun.write(ROOT + "/results-procs.json", JSON.stringify(results, null, 1));

const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[(s.length - 1) >> 1];
};
const pct = (v: number, b: number) => {
  const d = ((v - b) / b) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
};
const ms = (ns: number) => (ns / 1e6).toFixed(1) + "ms";

for (const metric of ["wall", "cpu"] as const) {
  console.log(`\n== ${metric === "wall" ? "wall time" : "cpu time (user+sys)"} ==`);
  const rows: string[][] = [["workload", pairs[0][1], ...pairs.map(([v, b]) => `${v} vs ${b}`)]];
  for (const [name, per] of Object.entries(results)) {
    const m = (bin: string) => med(per[bin].map(s => s[metric]));
    rows.push([name, ms(m(pairs[0][1])), ...pairs.map(([v, b]) => pct(m(v), m(b)))]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  for (const r of rows)
    console.log(r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  "));
}
console.log("\n== max RSS (bytes) ==");
for (const [name, per] of Object.entries(results)) {
  const m = (bin: string) => med(per[bin].map(s => s.rss));
  console.log(
    `${name.padEnd(36)} ${pairs[0][1]} ${String(m(pairs[0][1])).padStart(10)}  ` +
      pairs.map(([v, b]) => `${v} ${pct(m(v), m(b)).padStart(6)}`).join("  "),
  );
}
console.log(
  `\nruns=${runs} per binary per workload, interleaved; cell = median; delta = variant vs baseline (negative = faster).`,
);
