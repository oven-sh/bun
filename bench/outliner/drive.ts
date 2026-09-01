// Driver for suite.mjs: runs every binary R rounds, interleaved, and prints a comparison table.
//   bun drive.ts <rounds> [filter]
// env: BENCH_ROOT (dir with suite.mjs + fixtures), BENCH_BINS (JSON {label: path}),
//      BENCH_PAIRS (JSON [[variantLabel, baseLabel], ...]), BUN_SRC_ROOT
const rounds = Number(process.argv[2] ?? 3);
const filter = process.argv[3];
const ROOT = process.env.BENCH_ROOT ?? "/tmp/bench";
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
const results: Record<string, Record<string, number[]>> = {};

async function runOnce(bin: string): Promise<{ name: string; median: number; min: number }[]> {
  const args = [bins[bin], ROOT + "/suite.mjs"];
  if (filter) args.push(filter);
  const proc = Bun.spawn({
    cmd: args,
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
  });
  const [text, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (code !== 0) throw new Error(`${bin} exited ${code}: ${err.slice(-800)}`);
  const lines = text.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

const t0 = Date.now();
for (let r = 0; r < rounds; r++) {
  const order = names.map((_, i) => names[(i + r) % names.length]);
  for (const bin of order) {
    const res = await runOnce(bin);
    for (const b of res) ((results[b.name] ??= {})[bin] ??= []).push(b.median);
    process.stderr.write(`round ${r + 1}/${rounds} ${bin} done (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
}
await Bun.write(ROOT + "/results-inproc.json", JSON.stringify(results, null, 1));

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[(s.length - 1) >> 1];
};
const spread = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return ((s[s.length - 1] - s[0]) / median(s)) * 100;
};
const pct = (v: number, base: number) => {
  const d = ((v - base) / base) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
};
const fmt = (ns: number) =>
  ns >= 1e6 ? (ns / 1e6).toFixed(2) + "ms" : ns >= 1e3 ? (ns / 1e3).toFixed(2) + "us" : ns.toFixed(0) + "ns";

const header = ["benchmark", pairs[0][1], ...pairs.map(([v, b]) => `${v} vs ${b}`), "spread"];
const rows: string[][] = [header];
const geo = pairs.map(() => 0);
let n = 0;
for (const [bench, per] of Object.entries(results)) {
  const row = [bench, fmt(median(per[pairs[0][1]]))];
  pairs.forEach(([v, b], i) => {
    const d = median(per[v]) / median(per[b]);
    geo[i] += Math.log(d);
    row.push(pct(median(per[v]), median(per[b])));
  });
  row.push(Math.max(...names.map(b => spread(per[b]))).toFixed(1) + "%");
  rows.push(row);
  n++;
}
rows.push(["GEOMEAN", "", ...geo.map(g => pct(Math.exp(g / n), 1)), ""]);
const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  "));
console.log(
  `\nrounds=${rounds}; cell = median over rounds of per-run medians; delta = variant vs baseline (negative = faster); spread = max over binaries of (max-min)/median across rounds.`,
);
