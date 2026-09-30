// Instructions of the main thread, counted with icount.c (cc -O2 -o icount icount.c, same directory).
//   bun ee-icount.mjs --a <bun-profile> [--b <bun-profile>] [--cases hot|cold|name,name] [--tiers ftl,dfg,base,llint]
//                     [--pre none|inspect|keys] [--pre-b ..] [--reps 5] [--jobs 4] [--out file.json]
// <bun-profile> is the binary with symbols that the build writes beside bun (same code, same addresses).
// Hot case, per tier: instructions per iteration, median (lowest .. highest) over --reps of
// (I(n2) - I(n1)) / (n2 - n1). Cold case (tier default): instructions of the body over --reps processes;
// subtract cold_control. With --b: the same for B, and B - A.
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import path from "node:path";

const options = { a: {}, b: {}, cases: { default: "hot" }, tiers: { default: "ftl,dfg,base,llint" }, pre: { default: "none" }, "pre-b": {}, reps: { default: "5" }, jobs: { default: "4" }, out: {} };
for (const key in options) options[key].type = "string";
const { values: opt } = parseArgs({ options });
if (!opt.a) throw new Error("usage: bun ee-icount.mjs --a <bun-profile> [--b <bun-profile>] [--cases ..] [--tiers ..]");
const workload = path.join(import.meta.dir, "ee-cases.js");
const icount = path.join(import.meta.dir, "icount");
const concurrent = { BUN_JSC_useConcurrentJIT: "0" };
const tierEnv = { ftl: concurrent, dfg: { ...concurrent, BUN_JSC_useFTLJIT: "0" }, base: { ...concurrent, BUN_JSC_useDFGJIT: "0" }, llint: { BUN_JSC_useJIT: "0" }, default: {} };
// iterations between two markers [n1, n2]
const marks = { ftl: [64, 320], dfg: [64, 320], base: [32, 160], llint: [16, 80] };
const heavy = { add_10: [2, 6], shape_life: [2, 6], bench_stream_simulation: [1, 2] };
// process_emit_warning gives way to the event loop inside run(); one iteration of bench_on_emit_x1000 is millions
// of instructions, and what it does is in emit_3l_* and add_10
const skipped = ["process_emit_warning", "bench_on_emit_x1000"];
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME ?? "/root", NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" };
const reps = Number(opt.reps);
const text = cmd => Bun.spawnSync({ cmd, env: baseEnv, stdout: "pipe", stderr: "pipe" }).stdout.toString();
const sides = [{ key: "a", binary: path.resolve(opt.a), pre: opt.pre }];
if (opt.b) sides.push({ key: "b", binary: path.resolve(opt.b), pre: opt["pre-b"] ?? opt.pre });
for (const side of sides) {
  side.marker = text(["nm", "-C", side.binary]).split("\n").find(l => l.includes(" Bun::functionBunNanoseconds("))?.split(" ")[0];
  if (!side.marker) throw new Error("Bun::functionBunNanoseconds has no symbol in " + side.binary);
}
const kindOf = Object.fromEntries(text([sides[0].binary, workload, "--list"]).trim().split("\n").map(l => l.split(" ")));
const names = opt.cases
  .split(",")
  .flatMap(c => (c === "hot" || c === "cold" ? Object.keys(kindOf).filter(n => kindOf[n] === c) : [c]))
  .filter(n => (kindOf[n] === "hot" || kindOf[n] === "cold") && !skipped.includes(n));
const tiersOf = name => (kindOf[name] === "cold" ? ["default"] : opt.tiers.split(","));

async function intervals(side, name, tier, wanted, mark) {
  const proc = Bun.spawn({
    cmd: [icount, side.marker, String(wanted), side.binary, workload, name, tier, side.pre],
    env: { ...baseEnv, ...tierEnv[tier], EE_MARK: mark },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const timer = setTimeout(() => proc.kill(9), 1_200_000);
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);
  const counts = out.split("\n").filter(l => /^\d+$/.test(l)).map(Number);
  if (code === 0 && counts.length === wanted) return counts;
  console.error(`[failed] ${side.binary} ${name} ${tier} exit=${code} intervals=${counts.length} ${err.slice(0, 200)}`);
}
async function count(side, name, tier) {
  const each = [];
  if (kindOf[name] === "cold") {
    for (let r = 0; r < reps; r++) each.push((await intervals(side, name, tier, 1, "1"))?.[0]);
  } else {
    const [n1, n2] = heavy[name] ?? marks[tier];
    const counts = await intervals(side, name, tier, 2 * reps, `${n1},${n2},${reps}`);
    for (let r = 0; r < reps; r++) each.push(counts && (counts[2 * r + 1] - counts[2 * r]) / (n2 - n1));
  }
  if (each.includes(undefined)) return null;
  each.sort((x, y) => x - y);
  return { median: (each[Math.floor((reps - 1) / 2)] + each[Math.ceil((reps - 1) / 2)]) / 2, min: each[0], max: each.at(-1) };
}
const rows = names.flatMap(name => tiersOf(name).map(tier => ({ name, tier })));
const queue = [...rows];
async function lane() {
  for (let row; (row = queue.shift()); ) for (const side of sides) row[side.key] = await count(side, row.name, row.tier);
}
await Promise.all(Array.from({ length: Number(opt.jobs) }, lane));

for (const side of sides) console.log(`${side.key.toUpperCase()} = ${side.binary} (${text([side.binary, "--revision"]).trim()}) pre=${side.pre}`);
console.log("instructions of the main thread per iteration (cold: of the body): median (lowest .. highest)");
const show = r => (r ? `${r.median.toFixed(1).padStart(10)} (${r.min.toFixed(1)} .. ${r.max.toFixed(1)})` : "failed").padEnd(36);
for (const row of rows) {
  const diff = row.a && row.b ? row.b.median - row.a.median : NaN;
  const change = Number.isFinite(diff) ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} (${((diff / row.a.median) * 100).toFixed(1)}%)` : "";
  console.log(`${row.tier.padEnd(7)} ${row.name.padEnd(24)} ${show(row.a)} ${opt.b ? show(row.b) : ""} ${change}`);
}
if (opt.out) writeFileSync(opt.out, JSON.stringify({ sides, rows }));
