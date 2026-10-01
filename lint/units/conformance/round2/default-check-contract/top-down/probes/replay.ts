// The raw runs of a binary over the corpus (raw.ts of round2/default-check-classification/top-down/probes) through the default check's reading and the comparison, without a process.
// usage: bun replay.ts <scratch clone> <raw.jsonl> [level]
import { readFileSync } from "node:fs";
const [scratch, rawPath, levelArg = "first-section"] = process.argv.slice(2);
const runner = await import(`${scratch}/test/cli/lint/conformance/runner`);
const { resultOfRun } = await import(`${scratch}/test/cli/lint/conformance/runner/check_bun_lint`);
const corpus = runner.openCorpus(`${scratch}/test/cli/lint/conformance/corpus`);
const raw = new Map<string, any>();
for (const line of readFileSync(rawPath, "utf8").split("\n")) if (line !== "") { const r = JSON.parse(line); raw.set(r.name, r); }
const instances = corpus.enumerateInstances().filter((i: any) => i.status === "run");
// The raw file has the real root cut out of every path: the root is "" there, and a relative path is relative to the current directory.
const root = "/dcc1b-no-such-root";
const check = async (input: any) => {
  const r = raw.get(input.instance.name);
  if (r === undefined || r.notLaid !== undefined) throw new Error("no raw run");
  const ended = { exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut === true, stdout: r.stdout, stderr: r.stderr };
  return resultOfRun(ended, root, root + input.currentDirectory);
};
const results = await runner.runInstances(instances, check, {
  input: (i: any, below: any) => corpus.input(i, below),
  oracle: (i: any) => corpus.oracle(i),
  concurrency: 1,
  level: levelArg,
});
const by = new Map<string, number>();
const inc = (k: string, n = 1) => by.set(k, (by.get(k) ?? 0) + n);
const tally = new Map<string, { lines: number; instances: number }>();
const add = (kind: string, counts: Record<string, number> | undefined) => {
  for (const [name, n] of Object.entries(counts ?? {})) {
    const c = tally.get(`${kind} ${name}`) ?? { lines: 0, instances: 0 };
    tally.set(`${kind} ${name}`, { lines: c.lines + n, instances: c.instances + 1 });
  }
};
const guard = { silent: 0, rulesAlone: 0, warningsAlone: 0 };
const suites: Record<string, Record<string, number>> = {};
for (const r of results as any[]) {
  const k = r.instance.oracle.class;
  inc(`${k} ${r.outcome}${r.cause === undefined ? "" : ` [${r.cause}]`} level=${r.level}${r.headerOnly ? " headerOnly" : ""}`);
  add(`named ${k}`, r.named);
  add(`rules ${k}`, r.rules);
  if (k === "C") {
    if (r.outcome === "pass" && r.rules === undefined) guard.silent++;
    if (r.outcome === "pass" && r.rules !== undefined) guard.rulesAlone++;
    if (r.cause === "syntax warning") guard.warningsAlone++;
  }
  const suite = (suites[r.instance.suite] ??= {});
  const reached = !["crash", "timeout", "unsupported", "unavailable", "skip"].includes(r.outcome);
  suite.run = (suite.run ?? 0) + 1;
  if (reached) suite.result = (suite.result ?? 0) + 1;
  suite[`${k} ${r.outcome}`] = (suite[`${k} ${r.outcome}`] ?? 0) + 1;
  if (r.cause === "syntax" || r.cause === "syntax warning") suite[`${k} ${r.cause}`] = (suite[`${k} ${r.cause}`] ?? 0) + 1;
}
console.log(`instances ${results.length}, level asked ${levelArg}`);
for (const [k, n] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(String(n).padStart(6), k);
console.log("guard", JSON.stringify(guard));
for (const [k, c] of [...tally].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(`  ${k}: ${c.lines} lines in ${c.instances} instances`);
console.log(JSON.stringify(suites, null, 1));
const odd = (results as any[]).filter(r => r.outcome === "crash" && r.cause !== "check threw").slice(0, 5);
for (const r of odd) console.log("crash", r.instance.name, r.reason);
const firsts = (results as any[]).filter(r => r.cause === "syntax warning").map(r => `${r.instance.oracle.class} ${r.instance.name}: ${r.reason}`);
console.log(firsts.join("\n"));
