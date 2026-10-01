// Checks of the prototypes against the reference clone: list reader, oracle in both layouts, tags, lists, command line.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Corpus, type Suite, diffKey, diffRoot, errorBaselineName, errorKeys, ListedTwice, literalOracleOf, loadCorpus, oracleOf, readFileNameSet, readOracle, tagsOf } from "./baseline";
import { type Expectations, type InstanceFacts, type Outcome, checkLists, compareNames, compareWithRevision, ExpectationsError, formatExpectations, overQuota, parseExpectations, plan, reportText, sampleListed, verify } from "./expectations";
import { parseSweepArgs, select, updateCommand, UsageError } from "./sweep_args";
const P = new URL("../../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");

const GO = process.env.TSGO ?? "/workspace/ref/typescript-go";
const TS = GO + "/_submodules/TypeScript";
const HERE = new URL("..", import.meta.url).pathname;
let failed = 0;
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon((v as any)[k])])) : v;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(canon(actual)), b = JSON.stringify(canon(expected));
  if (a === b) console.log("ok   ", label, a.length > 100 ? "" : a);
  else { failed++; console.log("FAIL ", label, "\n   got      ", a.slice(0, 600), "\n   expected ", b.slice(0, 600)); }
}
function throws(label: string, f: () => unknown, type: Function, part: string) {
  try { f(); failed++; console.log("FAIL ", label, "did not throw"); }
  catch (e) {
    if (e instanceof type && (e as Error).message.includes(part)) console.log("ok   ", label, "->", (e as Error).message);
    else { failed++; console.log("FAIL ", label, "threw", e); }
  }
}

// ---- the list reader ----
eq("reader: comments, blank lines, spaces, carriage returns", [...readFileNameSet("# c\n\n  a/b.errors.txt.diff  \r\n#x\n\t# indented comment\nz\nz\n")], ["a/b.errors.txt.diff", "z"]);
eq("reader: Go trims U+0085 and keeps U+FEFF", [...readFileNameSet("\u0085a\u0085\n\uFEFF# not a comment\n")], ["a", "\uFEFF# not a comment"]);
eq("reader: a line of spaces only, no final line feed", [...readFileNameSet(" \t \nlast")], ["last"]);
eq("name of the baseline", [errorBaselineName("a.ts"), errorBaselineName("a(target=es2015).tsx"), errorBaselineName("a.ts.ts"), errorBaselineName("a.d.ts")], ["a.errors.txt", "a(target=es2015).errors.txt", "a.ts.errors.txt", "a.d.errors.txt"]);
eq("key", diffKey("compiler", "a.errors.txt"), "compiler/a.errors.txt.diff");
eq("root", [diffRoot(new Set(["k"]), new Set(), "k"), diffRoot(new Set(), new Set(["k"]), "k"), diffRoot(new Set(), new Set(), "k")], ["submoduleAccepted", "submoduleTriaged", "submodule"]);
throws("root: in both lists", () => diffRoot(new Set(["k"]), new Set(["k"]), "k"), ListedTwice, "in both");

// ---- the corpus in the layout of the reference and in the layout of the overlay ----
const reference = loadCorpus({
  tsgoBaselines: GO + "/testdata/baselines/reference/submodule",
  tsBaselines: undefined,
  expectsNoErrors: undefined,
  accepted: GO + "/testdata/submoduleAccepted.txt",
  triaged: GO + "/testdata/submoduleTriaged.txt",
  postEmitOrder: HERE + "vectors/post-emit-order.txt",
});
const e = enumerateInstances({ casesRoot: TS + "/tests/cases" });
const run = e.instances.filter((i: any) => i.status === "run");
eq("instances, run", [e.instances.length, run.length], [14915, 12797]);

const tmp = mkdtempSync(join(tmpdir(), "oe-selfcheck-"));
let copied = 0;
const tsNames = loadCorpus({ ...reference.paths, tsgoBaselines: tmp + "/none", tsBaselines: TS + "/tests/baselines/reference", expectsNoErrors: HERE + "../../corpus-layout-and-sync/top-down/vectors/tsgo.expects-no-errors.txt" }).ts!;
for (const suite of ["compiler", "conformance"] as Suite[]) {
  mkdirSync(`${tmp}/overlay/${suite}`, { recursive: true });
  for (const f of reference.tsgo.get(suite)!) {
    const a = readFileSync(`${reference.paths.tsgoBaselines}/${suite}/${f}`);
    if (tsNames.has(f) && a.equals(readFileSync(`${TS}/tests/baselines/reference/${f}`))) continue;
    copyFileSync(`${reference.paths.tsgoBaselines}/${suite}/${f}`, `${tmp}/overlay/${suite}/${f}`);
    copied++;
  }
}
eq("files of the overlay", copied, 674);
const overlay = loadCorpus({
  ...reference.paths,
  tsgoBaselines: tmp + "/overlay",
  tsBaselines: TS + "/tests/baselines/reference",
  expectsNoErrors: HERE + "../../corpus-layout-and-sync/top-down/vectors/tsgo.expects-no-errors.txt",
});
eq("names that expect no error", overlay.expectsNoErrors.size, 23);

function tally(c: Corpus, rule: typeof oracleOf) {
  const t = { E: 0, C: 0, compilerE: 0, conformanceE: 0, sources: {} as Record<string, number> };
  for (const i of run) {
    const o = rule(c, i.suite, i.name);
    t[o.kind]++;
    if (o.kind === "E") (t as any)[i.suite + "E"]++;
    t.sources[o.source] = (t.sources[o.source] ?? 0) + 1;
  }
  return t;
}
eq("oracle, layout of the reference", tally(reference, oracleOf), { E: 7027, C: 5770, compilerE: 3187, conformanceE: 3840, sources: { none: 5770, "typescript-go": 7027 } });
eq("oracle, layout of the overlay", tally(overlay, oracleOf), { E: 7027, C: 5770, compilerE: 3187, conformanceE: 3840, sources: { none: 5747, "typescript-go": 674, typescript: 6353, "expects-no-errors": 23 } });
eq("literal rule, layout of the overlay", tally(overlay, literalOracleOf), { E: 7050, C: 5747, compilerE: 3196, conformanceE: 3854, sources: { none: 5747, "typescript-go": 674, typescript: 6376 } });
let differ = 0;
for (const i of run) {
  const a = readOracle(oracleOf(reference, i.suite, i.name));
  const b = readOracle(oracleOf(overlay, i.suite, i.name));
  if ((a === undefined) !== (b === undefined) || (a !== undefined && !Buffer.from(a).equals(Buffer.from(b!)))) differ++;
}
eq("instances whose expected bytes differ between the layouts", differ, 0);

// ---- tags ----
const tagCount: Record<string, number> = {};
const tagKinds: Record<string, number> = {};
for (const i of run) {
  for (const t of tagsOf(overlay, i.suite, i.name)) {
    tagCount[t] = (tagCount[t] ?? 0) + 1;
    const k = t + " " + oracleOf(overlay, i.suite, i.name).kind;
    tagKinds[k] = (tagKinds[k] ?? 0) + 1;
  }
}
eq("tags", tagCount, { accepted: 442, triaged: 2, "post-emit-order": 3 });
eq("tags by kind", tagKinds, { "accepted E": 434, "accepted C": 8, "triaged C": 1, "triaged E": 1, "post-emit-order E": 3 });
eq("entries and error keys of the lists", [overlay.accepted.size, errorKeys(overlay.accepted).length, overlay.triaged.size, errorKeys(overlay.triaged).length], [1163, 442, 2, 2]);
const keysOfRun = new Set(run.map((i: any) => diffKey(i.suite, errorBaselineName(i.name))));
eq("error keys that name no run instance", [...errorKeys(overlay.accepted), ...errorKeys(overlay.triaged)].filter(k => !keysOfRun.has(k)), []);
const namesOfRun = new Set(run.map((i: any) => `${i.suite}/${errorBaselineName(i.name)}`));
eq("post-emit-order names that are no run instance", [...overlay.postEmitOrder].filter(k => !namesOfRun.has(k)), []);
eq("names that expect no error and are no run instance", [...overlay.expectsNoErrors].filter(k => !run.some((i: any) => `${i.suite}/${errorBaselineName(i.name)}` === k)), []);
rmSync(tmp, { recursive: true, force: true });

// ---- the lists ----
const facts = new Map<string, InstanceFacts>();
for (const i of e.instances) {
  facts.set(i.name, {
    name: i.name,
    directory: i.casePath.slice(0, i.casePath.lastIndexOf("/")),
    casePath: i.casePath,
    status: i.status,
    reason: i.reason,
    kind: i.status === "run" ? oracleOf(reference, i.suite, i.name).kind : undefined,
    tags: i.status === "run" ? tagsOf(reference, i.suite, i.name) : [],
    platformLimited: undefined,
  });
}
const empty: Expectations = { level: "first-section", E: [], C: [] };
eq("form of the empty lists", formatExpectations(empty), '{\n  "level": "first-section",\n  "E": [],\n  "C": []\n}\n');
const two: Expectations = { level: "first-section", E: ["2dArrays.ts", "b(target=es2015).ts", "bB.ts"], C: ["a.ts"] };
eq("form with names", formatExpectations(two), '{\n  "level": "first-section",\n  "E": [\n    "2dArrays.ts",\n    "b(target=es2015).ts",\n    "bB.ts"\n  ],\n  "C": [\n    "a.ts"\n  ]\n}\n');
eq("round trip", parseExpectations(formatExpectations(two)), two);
eq("order of code units", ["b.ts", "B.ts", "a(x=1).ts", "aB.ts", "a.ts", "2.ts", "a-b.ts", "a_b.ts"].sort(compareNames), ["2.ts", "B.ts", "a(x=1).ts", "a-b.ts", "a.ts", "aB.ts", "a_b.ts", "b.ts"]);
const bad = (label: string, text: string, part: string) => throws("lists: " + label, () => parseExpectations(text), ExpectationsError, part);
bad("not sorted", formatExpectations({ ...empty, E: ["b.ts", "a.ts"] }), "comes after");
bad("twice", formatExpectations({ ...empty, C: ["a.ts", "a.ts"] }), "twice");
bad("both lists", formatExpectations({ ...empty, E: ["a.ts"], C: ["a.ts"] }), "both lists");
bad("carriage returns", formatExpectations(two).replaceAll("\n", "\r\n"), "form");
bad("no final line feed", formatExpectations(two).trimEnd(), "form");
bad("one line", JSON.stringify(two), "form");
bad("other key", '{\n  "level": "first-section",\n  "E": [],\n  "C": [],\n  "X": []\n}\n', "keys");
bad("order of keys", '{\n  "E": [],\n  "C": [],\n  "level": "first-section"\n}\n', "keys");
bad("level", formatExpectations({ ...empty, level: "exact" as any }), "level");
bad("a number", '{\n  "level": "first-section",\n  "E": [\n    1\n  ],\n  "C": []\n}\n', "not a name");
bad("not JSON", "{", "not JSON");

const outcomesOf = (f: (i: InstanceFacts) => Outcome["status"] | undefined, level: Outcome["level"] = "first-section") => {
  const m = new Map<string, Outcome>();
  for (const i of facts.values()) {
    if (i.status !== "run") continue;
    const s = f(i);
    if (s !== undefined) m.set(i.name, { name: i.name, status: s, level, detail: s === "pass" ? "" : "line 1" });
  }
  return m;
};
// a checker that reports nothing
const silent = outcomesOf(i => (i.kind === "C" ? "pass" : "fail"));
const p0 = plan(empty, facts, silent);
eq("a checker that reports nothing: added, refused by the quota", [p0.added.E.length, p0.added.C.length, p0.refused.length, p0.refused.every(r => r.reason === "quota")], [0, 0, 5770, true]);
eq("a checker that reports nothing: the lists stay as they are", formatExpectations(p0.next), formatExpectations(empty));
// a checker that stands in everywhere
const standIn = outcomesOf(() => "provisional");
eq("stand-ins everywhere: nothing enters", [plan(empty, facts, standIn).added, plan(empty, facts, standIn).refused], [{ E: [], C: [] }, []]);
// everything passes
const all = outcomesOf(() => "pass");
const p1 = plan(empty, facts, all);
eq("everything passes: added E, added C, refused", [p1.added.E.length, p1.added.C.length, p1.refused.length], [7027, 5054, 716]);
eq("everything passes: the lists hold the quota", [checkLists(p1.next, facts), overQuota(p1.next, facts)], [[], []]);
eq("everything passes: the form parses", parseExpectations(formatExpectations(p1.next)).E.length, 7027);
eq("bytes of the largest file", formatExpectations(p1.next).length > 300_000, true);
console.log("      bytes of the file with every name that may enter:", formatExpectations(p1.next).length);
const p2 = plan(p1.next, facts, all);
eq("a second update adds nothing", [p2.added, formatExpectations(p2.next) === formatExpectations(p1.next)], [{ E: [], C: [] }, true]);
// one directory
const tuple = outcomesOf(i => (i.directory === "conformance/types/tuple" ? "pass" : undefined));
const p3 = plan(empty, facts, tuple);
const inTuple = [...facts.values()].filter(i => i.status === "run" && i.directory === "conformance/types/tuple");
console.log("      conformance/types/tuple: E", inTuple.filter(i => i.kind === "E").length, "C", inTuple.filter(i => i.kind === "C").length, "added", p3.added.E.length, p3.added.C.length);
eq("one directory: C is at most E", p3.added.C.length <= p3.added.E.length, true);
// a case that list E knows comes first
const sib = [...facts.values()].find(i => i.status === "run" && i.kind === "C" && [...facts.values()].some(j => j.casePath === i.casePath && j.kind === "E" && j.status === "run"))!;
const sibE = [...facts.values()].find(j => j.casePath === sib.casePath && j.kind === "E" && j.status === "run")!;
const firstC = [...facts.values()].filter(i => i.status === "run" && i.kind === "C" && i.directory === sib.directory).map(i => i.name).sort(compareNames)[0];
const p4 = plan(empty, facts, outcomesOf(i => (i.directory === sib.directory && (i.kind === "C" || i.name === sibE.name) ? "pass" : undefined)));
eq("the instance of a case that list E knows enters first", [p4.added.E, p4.added.C, firstC !== sib.name], [[sibE.name], [sib.name], true]);
// never removes, keeps the order
const before: Expectations = { level: "first-section", E: p1.next.E.slice(0, 50), C: [] };
const p5 = plan(before, facts, outcomesOf(i => (i.kind === "E" ? "fail" : "pass")));
eq("a listed name that fails stays", [p5.next.E.length, p5.added.E.length], [50, 0]);
eq("a listed name that fails is a failure", verify(before, outcomesOf(i => (i.kind === "E" ? "fail" : "pass"))).length, 50);
eq("names outside the selection say nothing", verify(before, new Map()).length, 0);
eq("a pass at the stricter level holds for the list", verify(before, outcomesOf(() => "pass", "baseline")), []);
eq("a failure at the stricter level says nothing", verify(before, outcomesOf(() => "fail", "baseline")).map(f => f.reason).filter((r, k, a) => a.indexOf(r) === k), ["level"]);
const strict: Expectations = { ...before, level: "baseline" };
eq("a pass at the weaker level does not hold", verify(strict, outcomesOf(() => "pass", "first-section")).map(f => f.reason).filter((r, k, a) => a.indexOf(r) === k), ["level"]);
eq("a pass at the stricter level enters", plan(empty, facts, outcomesOf(i => (i.kind === "E" ? "pass" : undefined), "baseline")).added.E.length, 7027);
eq("a pass at the weaker level does not enter", plan({ ...empty, level: "baseline" }, facts, outcomesOf(i => (i.kind === "E" ? "pass" : undefined), "first-section")).added.E.length, 0);
eq("sample: all below the limit", sampleListed(two, 10).map(n => n.list + " " + n.name), ["E 2dArrays.ts", "E b(target=es2015).ts", "E bB.ts", "C a.ts"]);
eq("sample: even distances", [sampleListed(p1.next, 200).length, sampleListed(p1.next, 200)[0].name, sampleListed(p1.next, 200).filter(n => n.list === "C").length, new Set(sampleListed(p1.next, 200).map(n => n.name)).size], [200, p1.next.E[0], 83, 200]);
// static checks
const skipped = [...facts.values()].find(i => i.status === "skipped")!;
const someC = [...facts.values()].find(i => i.status === "run" && i.kind === "C")!;
const someE = [...facts.values()].find(i => i.status === "run" && i.kind === "E")!;
const wrong: Expectations = { level: "first-section", E: [someC.name, "noSuchCase.ts", skipped.name].sort(compareNames), C: [someE.name] };
eq("static failures", checkLists(wrong, facts).map(f => `${f.list} ${f.reason}`).sort(), ["C wrong-list", "E not-an-instance", "E not-run", "E wrong-list"].sort());
const limited = new Map(facts);
limited.set(someE.name, { ...someE, platformLimited: "win32: a file name ends in a dot" });
eq("platform-limited: listed", checkLists({ ...empty, E: [someE.name] }, limited).map(f => f.reason), ["platform-limited"]);
eq("platform-limited: a pass does not enter", plan(empty, limited, new Map([[someE.name, { name: someE.name, status: "pass", level: "first-section", detail: "" } as Outcome]])).refused.map(r => r.reason), ["platform-limited"]);
eq("quota: list C above list E", [checkLists({ ...empty, C: [someC.name] }, facts), overQuota({ ...empty, C: [someC.name] }, facts).map(f => f.reason)], [[], ["quota"]]);
// another revision
const old: Expectations = { level: "first-section", E: [someE.name, "noSuchCase.ts"].sort(compareNames), C: [someC.name] };
eq("against a revision", compareWithRevision({ ...empty, E: [someC.name] }, old, facts), {
  removed: [{ name: someE.name, list: "E", stillAnInstance: true }, { name: "noSuchCase.ts", list: "E", stillAnInstance: false }].sort((a, b) => compareNames(a.name, b.name)),
  moved: [{ name: someC.name, from: "C", to: "E" }],
  levelLowered: false,
});
eq("against a revision without the file", compareWithRevision(empty, undefined, facts), { removed: [], moved: [], levelLowered: false });
eq("level lowered", compareWithRevision({ ...old, level: "first-section" }, { ...old, level: "baseline" }, facts).levelLowered, true);
console.log(reportText(p3, updateCommand(["--bin", "build/debug/bun-debug", "conformance/types/tuple/"])).split("\n").slice(0, 3).join("\n") + "\n      ...\n" + reportText(p3, updateCommand(["--bin", "build/debug/bun-debug", "conformance/types/tuple/"])).split("\n").slice(-3).join("\n"));

// ---- the command line ----
const o = parseSweepArgs(["compiler/", "--jobs=4", "--bin", "x/bun", "abstract*", "--update", "--report", "/tmp/r", "--since=origin/main"]);
eq("command line", [o.selectors, o.jobs, o.bin, o.update, o.report, o.since, o.run, o.timeoutMs], [["compiler/", "abstract*"], 4, "x/bun", true, "/tmp/r", "origin/main", true, 60000]);
for (const [args, part] of [
  [["--jobs", "0"], "whole number"], [["--jobs"], "needs a value"], [["--level", "exact"], "baseline or first-section"], [["--frob"], "unknown option"],
  [["--update=1"], "takes no value"], [["--bin", "a", "--check", "b"], "cannot go with"], [["--no-run", "--update"], "needs a run"], [["--jobs", "1", "--jobs", "2"], "twice"],
  [["--kind", "X"], "E or C"], [["--tag", "x"], "one of"], [["--corpus", "a", "--reference", "b"], "exclude"], [["--no-run", "--jobs", "2"], "no use"],
] as const) throws("command line: " + args.join(" "), () => parseSweepArgs(args), UsageError, part);
const allFacts = [...facts.values()];
const sel = (selectors: string[], more: object = {}) => select(allFacts, { selectors, listed: false, kind: undefined, tag: undefined, ...more }, new Set());
eq("selection: everything", sel([]).instances.length, 14915);
eq("selection: a suite", sel(["compiler/"]).instances.length, 7235);
eq("selection: a directory with what is below", [sel(["conformance/types/tuple/"]).instances.length > 0, sel(["conformance/types/"]).instances.length > sel(["conformance/types/tuple/"]).instances.length], [true, true]);
eq("selection: a case by its file name", sel(["abstractProperty.ts"]).instances.map(i => i.name), ["abstractProperty(target=es2015).ts", "abstractProperty(target=esnext).ts"]);
eq("selection: an instance", sel(["abstractProperty(target=esnext).ts"]).instances.map(i => i.name), ["abstractProperty(target=esnext).ts"]);
eq("selection: a case by its path", sel(["compiler/2dArrays.ts"]).instances.map(i => i.name), ["2dArrays.ts"]);
eq("selection: a pattern", sel(["abstractProperty*"]).instances.length, 8);
eq("selection: a selector that takes nothing", sel(["noSuchCase.ts", "compiler/"]).empty, ["noSuchCase.ts"]);
eq("selection: a directory is not a prefix of a name", sel(["conformance/types/tup/"]).instances.length, 0);
eq("selection: tag and kind", [sel([], { tag: "post-emit-order" }).instances.length, sel([], { tag: "triaged", kind: "C" }).instances.map(i => i.name)], [3, ["augmentExportEquals2.ts"]]);
eq("the command of the report", updateCommand(["--bin", "build/debug/bun-debug", "abstractProperty(target=es2015).ts", "--update"]), "bun test/cli/lint/conformance/sweep.ts --bin build/debug/bun-debug 'abstractProperty(target=es2015).ts' --update");
eq("the command of the report names the binary", updateCommand(["compiler/"], "/w/build/release/bun"), "bun test/cli/lint/conformance/sweep.ts --bin /w/build/release/bun compiler/ --update");

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
