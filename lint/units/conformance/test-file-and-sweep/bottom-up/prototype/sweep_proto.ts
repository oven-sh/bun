// Research prototype of sweep.ts: every instance through a check, the two tables, the report file.
// usage: bun sweep_proto.ts [--check empty|replay|spawn] [--bin path] [--jobs n] [--report path] [selector directory/]
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tsgoRules } from "../../../error-baseline-format/top-down/diagnosticwriter";
import { readErrorBaseline } from "../../../error-baseline-format/top-down/reader";
import { type Check, type CheckInput, createSpawnCheck, probe } from "../../../check-contract-default-spawn/top-down/check";
import { emptyCheck, replayCheck } from "../../../check-contract-default-spawn/top-down/checks";
import { type RunResult, runInstances } from "../../../check-contract-default-spawn/top-down/run";
import { type Instance, enumerateInstances } from "../../../instance-materialisation/prototype/enum_runner";
import { loadCorpus } from "../../../oracle-and-expectations/top-down/prototype/baseline";
import { type InstanceFacts, type Outcome, plan, reportText, verify } from "../../../oracle-and-expectations/top-down/prototype/expectations";
import { factsOf, inputOf, referenceLayout, runOracleOf } from "./glue";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const k = argv.indexOf(name);
  return k < 0 ? undefined : argv.splice(k, 2)[1];
};
const which = opt("--check") ?? "spawn";
const bin = opt("--bin") ?? process.execPath;
const jobs = Number(opt("--jobs") ?? availableParallelism());
const reportPath = opt("--report") ?? join(realpathSync(tmpdir()), "lint-conformance-proto-report.json");
const only = argv[0]?.replace(/\/$/, "");
const clock = (label: string, t: number) => process.stderr.write(`  ${label}: ${Math.round(performance.now() - t)} ms\n`);

const layout = referenceLayout();
let t = performance.now();
const e = enumerateInstances({ casesRoot: layout.casesRoot, only });
clock("enumerate", t);
t = performance.now();
const corpus = loadCorpus(layout);
const facts = new Map<string, InstanceFacts>(e.instances.map((i: Instance) => [i.name, factsOf(corpus, i)]));
clock("oracle kinds", t);
const below = mkdtempSync(join(realpathSync(tmpdir()), "lint-conformance-sweep-"));
t = performance.now();
const run = e.instances.filter((i: Instance) => i.status === "run");
const inputs: CheckInput[] = [];
const unbuilt: { name: string; reason: string }[] = [];
for (const i of run) {
  const r = inputOf(i, layout, below);
  if (r.ok) inputs.push(r.input);
  else unbuilt.push({ name: i.name, reason: `${r.status}: ${r.reason}` });
}
clock("inputs", t);
const oracles = new Map<string, ReturnType<typeof runOracleOf>>();
const oracle = (i: { suite: any; name: string }) => {
  let o = oracles.get(i.name);
  if (o === undefined) oracles.set(i.name, (o = runOracleOf(corpus, i.suite, i.name)));
  return o;
};
const env = { ...process.env } as Record<string, string | undefined>;
let check: Check;
if (which === "empty") check = emptyCheck();
else if (which === "replay") check = replayCheck(oracle);
else {
  check = createSpawnCheck({ command: [bin], env });
  const p = await probe({ command: [bin], env });
  if (!p.ok) console.log(`the binary ${bin} does not lint: ${p.reason}. No instance is handed to it.`);
}
t = performance.now();
let done = 0;
const results = await runInstances(inputs, check, { oracle, concurrency: jobs, timeoutMs: 60_000, onResult: () => { if (++done % 2000 === 0) process.stderr.write(`  ${done} of ${inputs.length}\n`); } });
clock(`check ${check.name} x${inputs.length}`, t);
rmSync(below, { recursive: true, force: true });

t = performance.now();
const statuses: Record<string, number> = { pass: 0, fail: 0, provisional: 0, error: 0, unsupported: 0 };
type Cell = { pass: number; total: number };
const cell = (): Cell => ({ pass: 0, total: 0 });
const byDirectory = new Map<string, { E: Cell; C: Cell; skipped: number }>();
const row = (d: string) => byDirectory.get(d) ?? (byDirectory.set(d, { E: cell(), C: cell(), skipped: 0 }), byDirectory.get(d)!);
for (const i of e.instances) if (i.status !== "run") row(dirname(i.casePath)).skipped++;
const byCode = new Map<number, { all: Cell; alone: Cell }>();
const casePathOf = new Map(run.map((i: Instance) => [i.name, i.casePath]));
for (const r of results) {
  statuses[r.status]++;
  const c = row(dirname(casePathOf.get(r.name)!))[r.kind];
  c.total++;
  if (r.status === "pass") c.pass++;
  if (r.kind !== "E") continue;
  const o = oracle(r as any);
  if (o.kind !== "E") continue;
  const codes = new Set<number>(readErrorBaseline(tsgoRules, tsgoRules.model.fromBytes(o.bytes)).diagnostics.map((d: any) => d.code));
  for (const code of codes) {
    const x = byCode.get(code) ?? (byCode.set(code, { all: cell(), alone: cell() }), byCode.get(code)!);
    for (const y of codes.size === 1 ? [x.all, x.alone] : [x.all]) {
      y.total++;
      if (r.status === "pass") y.pass++;
    }
  }
}
clock("tables", t);
const sum = (k: "E" | "C") => [...byDirectory.values()].reduce((a, b) => ({ pass: a.pass + b[k].pass, total: a.total + b[k].total }), cell());
const frac = (c: Cell) => `${c.pass}/${c.total}`;
console.log(`instances ${e.instances.length}: run ${run.length}, skipped ${e.instances.length - run.length}; check ${check.name}`);
console.log(`status: ${Object.entries(statuses).map(([k, v]) => `${k} ${v}`).join(", ")}${unbuilt.length > 0 ? `, not built ${unbuilt.length}` : ""}`);
console.log(`E (the oracle has errors): ${frac(sum("E"))} pass. C (the oracle has none): ${frac(sum("C"))} pass.`);
console.log("\nby directory, E pass/total and C pass/total:");
const group = (d: string) => d.split("/").slice(0, 2).join("/");
const groups = new Map<string, { E: Cell; C: Cell }>();
for (const [d, v] of byDirectory) {
  const g = groups.get(group(d)) ?? (groups.set(group(d), { E: cell(), C: cell() }), groups.get(group(d))!);
  for (const k of ["E", "C"] as const) { g[k].pass += v[k].pass; g[k].total += v[k].total; }
}
for (const [g, v] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(`  ${g.padEnd(34)} ${frac(v.E).padStart(10)} ${frac(v.C).padStart(10)}`);
console.log("\nby diagnostic code, instances that pass / instances whose oracle has the code, and the same where it is the only code:");
const codes = [...byCode].sort((a, b) => b[1].all.total - a[1].all.total || a[0] - b[0]);
for (const [code, v] of codes.slice(0, 25)) console.log(`  TS${String(code).padEnd(6)} ${frac(v.all).padStart(10)} ${frac(v.alone).padStart(10)}`);
console.log(`  ... ${codes.length} codes, ${codes.filter(c => c[1].all.pass === c[1].all.total).length} with every instance passing; the report has all of them`);
const outcomes = new Map<string, Outcome>(results.map((r: RunResult) => [r.name, { name: r.name, status: r.status, level: r.level ?? "baseline", detail: r.reason }]));
const lists = { level: "baseline" as const, E: [], C: [] };
const p = plan(lists, facts, outcomes);
console.log(`\nlisted: E ${lists.E.length}, C ${lists.C.length}; listed and not passing: ${verify(lists, outcomes).length}`);
console.log(reportText(p, "bun test/cli/lint/conformance/sweep.ts --update") || "no instance passes that is not listed and may enter");
mkdirSync(dirname(reportPath), { recursive: true });
const report = {
  version: 1,
  check: check.name,
  binary: which === "spawn" ? bin : undefined,
  totals: { instances: e.instances.length, run: run.length, skipped: e.instances.length - run.length, status: statuses, E: sum("E"), C: sum("C") },
  byDirectory: [...byDirectory].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([directory, v]) => ({ directory, ...v })),
  byCode: codes.map(([code, v]) => ({ code, pass: v.all.pass, total: v.all.total, alonePass: v.alone.pass, aloneTotal: v.alone.total })),
  passNotListed: p.added,
  refused: p.refused.length,
  instances: results.map((r: RunResult) => ({ name: r.name, suite: r.suite, kind: r.kind, status: r.status, level: r.level, reason: r.reason })),
};
writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
console.log(`report: ${reportPath} (${Bun.file(reportPath).size} bytes)`);
