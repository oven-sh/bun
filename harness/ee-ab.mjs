// A/B driver on CPU time. One sample is one new process of ee-cases.js (same directory).
//   bun ee-ab.mjs --a <binary> --b <binary> [--cases all|hot|macro|cold|name,name] [--tiers ftl,dfg,base,llint,default]
//                 [--pre none|inspect|keys] [--pre-b ..] [--rounds 15] [--max-rounds 45] [--resolve 3] [--floor 1]
//                 [--jobs 4] [--raw] [--handicap-b 2] [--out raw.json]
// A round is the four runs A B A B (B A B A in every second round). Per case, tier and metric:
//   min, lower quartile, median, upper quartile of A and of B, in milliseconds of CPU time,
//   d    = exp(median(ln(B/A))) - 1 over the neighbouring pairs (A1,B1) and (A2,B2) of every round,
//   dAA  = the same for the pairs (A1,A2): one binary against itself; dBB for (B1,B2),
//   sAA  = half the interquartile range of A2/A1 over the rounds,
//   R    = what the measurement resolves: max(floor, |dAA|, |dBB|, S95); S95 is the 95th percentile of |d| when A
//          and B trade places at random inside each pair (4000 draws),
//   slow = runs of A / of B that took more than twice the lower quartile of all runs of the case (the JIT stayed
//          in a lower tier); they are left out of every other number.
// Verdict: see section 8 of the findings. Exit code 1: a case is SLOWER. 3: the reference differs, use --raw.
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import path from "node:path";

const { values: opt } = parseArgs({
  options: {
    a: { type: "string" },
    b: { type: "string" },
    cases: { type: "string", default: "all" },
    tiers: { type: "string" },
    pre: { type: "string", default: "none" },
    "pre-b": { type: "string" },
    rounds: { type: "string", default: "15" },
    "max-rounds": { type: "string", default: "45" },
    resolve: { type: "string", default: "3" },
    floor: { type: "string", default: "1" },
    jobs: { type: "string", default: "4" },
    raw: { type: "boolean", default: false },
    "handicap-b": { type: "string" },
    out: { type: "string" },
  },
});
if (!opt.a || !opt.b) {
  console.error("usage: bun ee-ab.mjs --a <binary> --b <binary> [--cases ..] [--tiers ..] [--pre ..]");
  process.exit(2);
}
const workload = path.join(import.meta.dir, "ee-cases.js");
const binary = { a: path.resolve(opt.a), b: path.resolve(opt.b) };
const pre = { a: opt.pre, b: opt["pre-b"] ?? opt.pre };
const tierEnv = {
  ftl: { BUN_JSC_useConcurrentJIT: "0" },
  dfg: { BUN_JSC_useConcurrentJIT: "0", BUN_JSC_useFTLJIT: "0" },
  base: { BUN_JSC_useConcurrentJIT: "0", BUN_JSC_useDFGJIT: "0" },
  llint: { BUN_JSC_useJIT: "0" },
  default: {},
};
const tiersOf = { hot: ["ftl", "dfg", "base", "llint", "default"], macro: ["ftl", "default"], cold: ["default"] };
// per kind: the groups of metrics, one metric of every group gets the verdict
const groupsOf = {
  hot: [["thr_us", "nthr_us"], ["cpu_us", "ncpu_us"]],
  macro: [["all_thr_us"], ["all_cpu_us"]],
  cold: [["thr_us"], ["cpu_us"]],
};
const shown = ["thr_us", "nthr_us", "cpu_us", "ncpu_us", "ref_us", "all_thr_us", "all_cpu_us", "exit_cpu_us"];
const wanted = opt.tiers?.split(",");
for (const tier of wanted ?? []) if (!tierEnv[tier]) throw new Error("unknown tier " + tier);
const firstRounds = Number(opt.rounds);
const maxRounds = Math.max(firstRounds, Number(opt["max-rounds"]));
const resolveAt = Number(opt.resolve) / 100;
const floor = Number(opt.floor) / 100;
const jobs = Math.max(1, Number(opt.jobs));
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME ?? "/root", NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" };
const running = new Set();
process.on("exit", () => {
  for (const proc of running) proc.kill(9);
});

async function sample(side, name, tier) {
  const cmd = [binary[side], workload, name, tier, pre[side]];
  for (let attempt = 0; attempt < 3; attempt++) {
    const proc = Bun.spawn({
      cmd,
      env: { ...baseEnv, ...tierEnv[tier], ...(side === "b" && opt["handicap-b"] ? { EE_HANDICAP: opt["handicap-b"] } : {}) },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    running.add(proc);
    const timer = setTimeout(() => proc.kill(9), 300_000);
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    clearTimeout(timer);
    running.delete(proc);
    let json;
    try {
      json = JSON.parse(out.trim().split("\n").pop());
    } catch {}
    if (code === 0 && json) {
      // CPU time of the whole process, start and exit included
      json.exit_cpu_us = Number(proc.resourceUsage().cpuTime.total);
      return json;
    }
    console.error(`[retry] ${cmd.join(" ")} exit=${code} ${err.slice(0, 300)}`);
  }
  throw new Error("3 failures: " + cmd.join(" "));
}

function quantile(values, q) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
const median = values => quantile(values, 0.5);
const relative = logs => Math.exp(median(logs)) - 1;
let seed = 0x9e3779b9;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
function swapped95(logs) {
  if (logs.length < 4) return NaN;
  const centre = median(logs);
  const draws = [];
  for (let r = 0; r < 4000; r++) {
    draws.push(Math.abs(relative(logs.map(v => (random() < 0.5 ? v - centre : centre - v)))));
  }
  return quantile(draws, 0.95);
}
// rounds: [{ a1, b1, a2, b2 }], each the JSON line of one run
function stats(rounds, metric) {
  const value = run => Math.max(run[metric], 1);
  const limit = 2 * quantile(rounds.flatMap(r => [r.a1, r.a2, r.b1, r.b2]).map(value), 0.25);
  const fast = run => value(run) <= limit;
  const log = (x, y) => Math.log(value(x) / value(y));
  const ab = [];
  const aa = [];
  const bb = [];
  for (const r of rounds) {
    if (fast(r.a1) && fast(r.b1)) ab.push(log(r.b1, r.a1));
    if (fast(r.a2) && fast(r.b2)) ab.push(log(r.b2, r.a2));
    if (fast(r.a1) && fast(r.a2)) aa.push(log(r.a2, r.a1));
    if (fast(r.b1) && fast(r.b2)) bb.push(log(r.b2, r.b1));
  }
  const summary = runs => {
    const kept = runs.filter(fast).map(value);
    return { min: Math.min(...kept), q1: quantile(kept, 0.25), med: median(kept), q3: quantile(kept, 0.75), slow: runs.length - kept.length };
  };
  const d = relative(ab);
  const dAA = relative(aa);
  const dBB = relative(bb);
  const sAA = (Math.exp(quantile(aa, 0.75)) - Math.exp(quantile(aa, 0.25))) / 2;
  const R = Math.max(floor, Math.abs(dAA), Math.abs(dBB), swapped95(ab));
  const A = summary(rounds.flatMap(r => [r.a1, r.a2]));
  const B = summary(rounds.flatMap(r => [r.b1, r.b2]));
  return { metric, rounds: rounds.length, A, B, d, dAA, dBB, sAA, R, slower: d > R, resolved: R <= resolveAt };
}
async function measure(item, fixed) {
  const rounds = [];
  for (;;) {
    const want = fixed ?? (rounds.length === 0 ? firstRounds : Math.min(maxRounds, rounds.length + 5));
    while (rounds.length < want) {
      const round = {};
      const order = rounds.length % 2 === 0 ? ["a1", "b1", "a2", "b2"] : ["b1", "a1", "b2", "a2"];
      for (const key of order) round[key] = await sample(key[0], item.name, item.tier);
      rounds.push(round);
    }
    const decisive = groupsOf[item.kind].map(group => {
      const candidates = (opt.raw || item.tier === "default" ? group.slice(0, 1) : group).map(metric => stats(rounds, metric));
      return candidates.reduce((best, s) => (s.R < best.R ? s : best));
    });
    if (fixed || decisive.every(s => s.resolved) || rounds.length >= maxRounds) return { rounds, decisive };
  }
}

const ms = v => (Number.isFinite(v) ? (v / 1000).toFixed(v < 10000 ? 3 : 1) : "-");
const pct = v => (Number.isFinite(v) ? (v >= 0 ? "+" : "") + (v * 100).toFixed(1) : "-");
function format(row) {
  const side = s => [ms(s.min), ms(s.q1), ms(s.med), ms(s.q3)].map(v => v.padStart(8)).join("");
  const numbers = [pct(row.d), pct(row.dAA), pct(row.dBB), pct(row.sAA), pct(row.R)].map(v => v.padStart(6)).join(" ");
  const slow = `${row.A.slow}/${row.B.slow}`.padStart(6);
  return `${row.tier.padEnd(7)} ${row.case.padEnd(24)} ${row.metric.padEnd(11)} ${String(row.iters).padStart(9)} ${String(row.rounds).padStart(3)} ${side(row.A)}  |${side(row.B)}  | ${numbers} ${slow}  ${row.verdict}`;
}

const revision = file => Bun.spawnSync({ cmd: [file, "--revision"], env: baseEnv }).stdout.toString().trim();
const listed = Bun.spawnSync({ cmd: [binary.a, workload, "--list"], env: baseEnv }).stdout.toString().trim().split("\n");
const kindOf = Object.fromEntries(listed.map(l => l.split(" ")));
const all = Object.keys(kindOf);
const names = opt.cases === "all" ? all : opt.cases.split(",").flatMap(c => (tiersOf[c] ? all.filter(n => kindOf[n] === c) : [c]));
const queue = [];
for (const name of names) {
  const kind = kindOf[name];
  if (!kind) throw new Error("unknown case " + name);
  for (const tier of tiersOf[kind]) if (!wanted || wanted.includes(tier)) queue.push({ name, tier, kind });
}
console.log(`A = ${binary.a} (${revision(binary.a)}) pre=${pre.a}`);
console.log(`B = ${binary.b} (${revision(binary.b)}) pre=${pre.b}`);
const load = (await Bun.file("/proc/loadavg").text()).trim();
console.log(`rounds ${firstRounds}..${maxRounds} of 4 runs, resolve ${opt.resolve}%, floor ${opt.floor}%, jobs ${jobs}, load ${load}`);
console.log("times: milliseconds of CPU time (user+sys)");
console.log(
  "tier    case                     metric          iters   K    A.min    A.q1   A.med    A.q3  |   B.min    B.q1   B.med    B.q3  |     d%   dAA%   dBB%   sAA%     R%   slow  verdict",
);
const rows = [];
const raw = [];
async function lane() {
  for (let item; (item = queue.shift()); ) {
    const measurements = [await measure(item)];
    let verdict = "ok";
    if (measurements[0].decisive.some(s => s.slower)) {
      measurements.push(await measure(item, measurements[0].rounds.length));
      verdict = "ok(2nd)";
      if (measurements[1].decisive.some(s => s.slower)) {
        measurements.push(await measure(item, maxRounds));
        verdict = measurements[2].decisive.some(s => s.slower) ? "SLOWER" : "ok(3rd)";
      }
    }
    const last = measurements.at(-1);
    if (!last.decisive.every(s => s.resolved)) verdict += " WIDE";
    const runs = measurements.flatMap(m => m.rounds).flatMap(r => [r.a1, r.a2, r.b1, r.b2]);
    if (item.kind !== "macro" && new Set(runs.map(r => JSON.stringify([r.sink, r.iters]))).size !== 1) verdict += " WORK-DIFFERS";
    for (const metric of shown) {
      const decides = last.decisive.some(s => s.metric === metric);
      if (typeof last.rounds[0].a1[metric] !== "number") continue;
      const common = { tier: item.tier, case: item.name, iters: last.rounds[0].a1.iters };
      const row = { ...common, verdict: decides ? verdict : "-", ...stats(last.rounds, metric) };
      rows.push(row);
      console.log(format(row));
      if (!decides) continue;
      measurements.slice(0, -1).forEach((m, i) => {
        console.log(format({ ...common, verdict: `(measurement ${i + 1})`, ...stats(m.rounds, metric) }));
      });
    }
    if (item.kind === "cold") {
      const both = key => ["a", "b"].map(s => median(last.rounds.flatMap(r => [r[s + 1], r[s + 2]]).map(r => r[key])));
      const keys = ["retained_bytes", "retained_extra_bytes", "retained_objects"];
      console.log(`        ${item.name.padEnd(24)} medians A/B: ` + keys.map(k => `${k} ${both(k).join("/")}`).join("  "));
      console.log(`        ${item.name.padEnd(24)} allocated A/B: ${JSON.stringify(last.rounds[0].a1.types)} ${JSON.stringify(last.rounds[0].b1.types)}`);
    }
    raw.push({ ...item, measurements: measurements.map(m => m.rounds) });
  }
}
await Promise.all(Array.from({ length: jobs }, lane));

const decided = rows.filter(r => r.verdict !== "-");
const slower = decided.filter(r => r.verdict.startsWith("SLOWER"));
const wide = decided.filter(r => r.verdict.includes("WIDE"));
console.log(`\n${decided.length} rows with a verdict: ${slower.length} SLOWER, ${wide.length} WIDE`);
for (const row of slower) console.log(format(row));
let referenceDiffers = false;
for (const tier of Object.keys(tierEnv)) {
  const rounds = raw.filter(item => item.kind === "hot" && item.tier === tier).flatMap(item => item.measurements.flat());
  if (rounds.length === 0 || tier === "default") continue;
  const s = stats(rounds, "ref_us");
  const differs = !opt.raw && Math.abs(s.d) > Math.max(0.02, s.R);
  referenceDiffers ||= differs;
  console.log(`reference, tier ${tier}: B against A ${pct(s.d)}%, R ${pct(s.R)}%, ${2 * rounds.length} pairs${differs ? "  MEASURE THIS TIER AGAIN WITH --raw" : ""}`);
}
if (opt.out) writeFileSync(opt.out, JSON.stringify({ binary, pre, floor, resolveAt, rows, raw }));
process.exit(slower.length ? 1 : referenceDiffers ? 3 : 0);
