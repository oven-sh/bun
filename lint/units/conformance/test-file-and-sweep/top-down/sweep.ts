// Research prototype of test/cli/lint/conformance/sweep.ts, wired to the prototypes of the first wave and to the reference clone.
// In the repository: "./runner" for "./index", the committed corpus for referenceLayout() when --reference is absent.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  type Check,
  type CheckInput,
  type InstanceFacts,
  type Outcome,
  type RunResult,
  UsageError,
  checkLists,
  compareWithRevision,
  createSpawnCheck,
  enumerateInstances,
  factsOf,
  formatExpectations,
  inputOf,
  loadCorpus,
  parseExpectations,
  parseSweepArgs,
  plan,
  readErrorBaseline,
  referenceLayout,
  reportText,
  roundTrip,
  runInstances,
  runOracleOf,
  select,
  tscRules,
  tsgoRules,
  updateCommand,
  usage,
  verify,
} from "./index";

// The prototype takes this switch before the options of the first wave are read: parseSweepArgs has to learn it.
const roundTripOnly = process.argv.includes("--round-trip");
const argv = process.argv.slice(2).filter(a => a !== "--round-trip");
const fail = (message: string): never => {
  process.stderr.write(`sweep: ${message}\n\n${usage}`);
  process.exit(2);
};
let o: ReturnType<typeof parseSweepArgs>;
try {
  o = parseSweepArgs(argv);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  o = fail(e.message);
}
if (o.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const started = performance.now();
const layout = referenceLayout(o.reference);
const corpus = loadCorpus(layout);

// Every error baseline read and written again: the whole of what the test file samples.
if (roundTripOnly) {
  const differ: string[] = [];
  let files = 0;
  const one = (path: string, rules: typeof tsgoRules) => {
    files++;
    if (!roundTrip(readFileSync(path), rules).equal) differ.push(path);
  };
  for (const suite of ["compiler", "conformance"] as const) {
    for (const name of corpus.tsgo.get(suite)!) one(`${layout.tsgoBaselines}/${suite}/${name}`, tsgoRules);
  }
  for (const name of corpus.ts ?? []) one(`${layout.tsBaselines}/${name}`, tscRules);
  for (const path of differ) process.stdout.write(`differs: ${path}\n`);
  process.stdout.write(
    `${files - differ.length} of ${files} error baselines are the same bytes after a read and a write\n`,
  );
  process.exit(differ.length > 0 ? 1 : 0);
}
const expectationsPath = resolve(o.expectations ?? join(import.meta.dir, "expectations.json"));
const lists = parseExpectations(readFileSync(expectationsPath, "utf8"));
const listed = new Set([...lists.E, ...lists.C]);

const enumeration = enumerateInstances({ casesRoot: layout.casesRoot });
const byName = new Map(enumeration.instances.map(i => [i.name, i]));
const facts = new Map<string, InstanceFacts>(enumeration.instances.map(i => [i.name, factsOf(corpus, i)]));
const selection = select([...facts.values()], o, listed);
if (selection.empty.length > 0) fail(`no instance for ${selection.empty.join(", ")}`);
const selected = selection.instances;
const toRun = selected.filter(i => i.status === "run");

const out: string[] = [];
const say = (line = "") => {
  out.push(line);
  process.stdout.write(line + "\n");
};
const count = <T>(all: Iterable<T>, key: (x: T) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of all) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};

say(
  `instances ${facts.size}: run ${[...facts.values()].filter(i => i.status === "run").length}, skipped ${[...facts.values()].filter(i => i.status === "skipped").length}; selected ${selected.length}, of which run ${toRun.length}`,
);

// What needs no run: the lists against the corpus and against another revision.
const staticFailures = checkLists(lists, facts);
for (const f of staticFailures) say(`listed in ${f.list} and ${f.reason}: ${f.name}: ${f.detail}`);
let shrunk = false;
if (o.since !== undefined) {
  const top = Bun.spawnSync({ cmd: ["git", "rev-parse", "--show-toplevel"], cwd: dirname(expectationsPath) })
    .stdout.toString()
    .trim();
  const rel = expectationsPath.slice(top.length + 1);
  const show = Bun.spawnSync({ cmd: ["git", "show", `${o.since}:${rel}`], cwd: top });
  const old = show.exitCode === 0 ? parseExpectations(show.stdout.toString()) : undefined;
  const shrink = compareWithRevision(lists, old, facts);
  for (const r of shrink.removed) say(`removed since ${o.since}: ${r.list} ${r.name}`);
  for (const m of shrink.moved) say(`moved since ${o.since}: ${m.name} from ${m.from} to ${m.to}`);
  if (shrink.levelLowered) say(`the level was lowered since ${o.since}`);
  shrunk = shrink.removed.length > 0 || shrink.moved.length > 0 || shrink.levelLowered;
}
if (!o.run) process.exit(staticFailures.length > 0 || shrunk ? 1 : 0);

const binary = o.bin ?? process.execPath;
let check: Check;
if (o.check !== undefined) {
  const module = await import(resolve(o.check));
  check = typeof module.default === "function" ? await module.default({ layout, corpus }) : module.default;
} else {
  check = createSpawnCheck({ command: [binary], env: process.env });
}

const directory = mkdtempSync(join(realpathSync(tmpdir()), "bun-lint-sweep-"));
const inputs: CheckInput[] = [];
const results = new Map<string, { status: string; level?: string; reason: string }>();
for (const i of toRun) {
  const r = inputOf(byName.get(i.name)!, { layout, materialiseBelow: directory });
  if (r.ok) inputs.push(r.input);
  else results.set(i.name, { status: "unsupported", reason: `${r.status}: ${r.reason}` });
}
const oracles = new Map<string, ReturnType<typeof runOracleOf>>();
const oracle = (i: { name: string; suite: "compiler" | "conformance" }) => {
  let x = oracles.get(i.name);
  if (x === undefined) oracles.set(i.name, (x = runOracleOf(corpus, i.suite, i.name)));
  return x;
};
let done = 0;
const tty = process.stderr.isTTY;
const ran: RunResult[] = await runInstances(inputs, check, {
  oracle,
  concurrency: o.jobs ?? availableParallelism(),
  timeoutMs: o.timeoutMs,
  onResult() {
    done++;
    if (tty && done % 50 === 0) process.stderr.write(`\r${done} of ${inputs.length}`);
    else if (!tty && done % 2000 === 0) process.stderr.write(`${done} of ${inputs.length}\n`);
  },
});
if (tty) process.stderr.write("\r");
rmSync(directory, { recursive: true, force: true });
for (const r of ran) results.set(r.name, { status: r.status, level: r.level, reason: r.reason });

const passes = (name: string) => results.get(name)?.status === "pass";
const kindOf = (name: string) => facts.get(name)!.kind!;
const ratio = (names: string[]) => `${names.filter(passes).length} of ${names.length}`;
const runNames = toRun.map(i => i.name);
say(`check ${check.name}${o.check === undefined ? `, binary ${binary}` : ""}`);
say(
  `pass ${ratio(runNames)}: E ${ratio(runNames.filter(n => kindOf(n) === "E"))}, C ${ratio(runNames.filter(n => kindOf(n) === "C"))}`,
);
say("by status: " + [...count(runNames, n => results.get(n)!.status)].map(([k, v]) => `${k} ${v}`).join(", "));
const reasons = [
  ...count(
    runNames.filter(n => !passes(n)),
    n => results.get(n)!.reason.replace(/\d+/g, "n").slice(0, 100),
  ),
].sort((a, b) => b[1] - a[1]);
for (const [reason, n] of reasons.slice(0, 10)) say(`  ${String(n).padStart(6)}  ${reason}`);
if (reasons.length > 10) say(`  and ${reasons.length - 10} more reasons in the report`);

// A group is the suite, or the suite and the first directory below it; the report has every directory.
const groupOf = (directory: string) => directory.split("/").slice(0, 2).join("/");
interface Cell {
  E: [number, number];
  C: [number, number];
}
const cells = (key: (i: InstanceFacts) => string) => {
  const m = new Map<string, Cell>();
  for (const i of toRun) {
    let c = m.get(key(i));
    if (c === undefined) m.set(key(i), (c = { E: [0, 0], C: [0, 0] }));
    c[i.kind!][1]++;
    if (passes(i.name)) c[i.kind!][0]++;
  }
  return new Map([...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
};
say();
say("by directory: E pass of total, C pass of total");
for (const [group, c] of cells(i => groupOf(i.directory)))
  say(
    `  ${group.padEnd(34)} E ${String(c.E[0]).padStart(5)} of ${String(c.E[1]).padEnd(5)} C ${String(c.C[0]).padStart(5)} of ${c.C[1]}`,
  );

// The codes of the first section of each oracle: an instance counts once for each code that it has.
const codes = new Map<number, { instances: number; pass: number; diagnostics: number }>();
for (const i of toRun) {
  if (i.kind !== "E") continue;
  const x = oracle(byName.get(i.name)!);
  if (x.kind !== "E") continue;
  const all = readErrorBaseline(tsgoRules, tsgoRules.model.fromBytes(x.bytes)).diagnostics.map(d => d.code);
  for (const code of new Set(all)) {
    let c = codes.get(code);
    if (c === undefined) codes.set(code, (c = { instances: 0, pass: 0, diagnostics: 0 }));
    c.instances++;
    if (passes(i.name)) c.pass++;
    c.diagnostics += all.filter(k => k === code).length;
  }
}
const byCode = [...codes].sort((a, b) => b[1].instances - a[1].instances || a[0] - b[0]);
say();
say(`by diagnostic code: ${byCode.length} codes; instances that pass of instances whose oracle has the code`);
for (const [code, c] of byCode.slice(0, 25))
  say(`  TS${String(code).padEnd(6)} ${String(c.pass).padStart(5)} of ${c.instances}`);
if (byCode.length > 25) say(`  and ${byCode.length - 25} more codes in the report`);

// The lists: a listed name that does not pass fails the sweep, a name that passes and is not listed is printed.
const outcomes = new Map<string, Outcome>();
for (const n of runNames) {
  const r = results.get(n)!;
  outcomes.set(n, {
    name: n,
    status: r.status as Outcome["status"],
    level: (r.level ?? lists.level) as Outcome["level"],
    detail: r.reason,
  });
}
const failures = verify(lists, outcomes);
say();
say(
  `listed: E ${lists.E.length}, C ${lists.C.length}; of the selection ${runNames.filter(n => listed.has(n)).length}; not passing ${failures.length}`,
);
for (const f of failures) say(`  FAIL ${f.list} ${f.name}: ${f.reason}: ${f.detail.split("\n")[0]}`);
const p = plan(lists, facts, outcomes);
const text = reportText(p, updateCommand(argv, o.check === undefined ? binary : undefined));
if (text !== "") say(text);
if (o.update && p.added.E.length + p.added.C.length > 0) {
  writeFileSync(expectationsPath, formatExpectations(p.next));
  say(`added E ${p.added.E.length}, C ${p.added.C.length} to ${expectationsPath}`);
}

const reportPath = resolve(o.report ?? join(tmpdir(), "bun-lint-conformance", "report.json"));
mkdirSync(dirname(reportPath), { recursive: true });
const report = {
  version: 1,
  check: check.name,
  binary: o.check === undefined ? binary : undefined,
  selectors: o.selectors,
  level: lists.level,
  seconds: Math.round((performance.now() - started) / 100) / 10,
  totals: {
    instances: facts.size,
    selected: selected.length,
    run: toRun.length,
    pass: runNames.filter(passes).length,
    E: [runNames.filter(n => kindOf(n) === "E" && passes(n)).length, runNames.filter(n => kindOf(n) === "E").length],
    C: [runNames.filter(n => kindOf(n) === "C" && passes(n)).length, runNames.filter(n => kindOf(n) === "C").length],
    status: Object.fromEntries(count(runNames, n => results.get(n)!.status)),
  },
  directories: Object.fromEntries(cells(i => i.directory)),
  codes: Object.fromEntries(byCode.map(([code, c]) => ["TS" + code, c])),
  listed: { E: lists.E.length, C: lists.C.length, failures },
  notListed: p.added,
  refused: p.refused,
  skipped: Object.fromEntries(
    count(
      selected.filter(i => i.status !== "run"),
      i => i.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1"),
    ),
  ),
  instances: Object.fromEntries(runNames.map(n => [n, { kind: kindOf(n), ...results.get(n)! }])),
  text: out,
};
writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
process.stdout.write(`report ${reportPath}\n`);
process.exit(staticFailures.length > 0 || shrunk || failures.length > 0 ? 1 : 0);
