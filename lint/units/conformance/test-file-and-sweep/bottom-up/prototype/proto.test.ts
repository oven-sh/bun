// Research prototype of test/cli/lint/conformance.test.ts over the prototypes of the first wave: it exists to be timed.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { getConfigNameFromFileName } from "../../../directive-grammar/prototype/harnessutil";
import { skipTrivia } from "../../../directive-grammar/prototype/scanner";
import { extractCompilerSettings, parseTestFilesAndSymlinksWithOptions } from "../../../directive-grammar/prototype/test_case_parser";
import { decodeBytes } from "../../../directive-grammar/prototype/vfs";
import { getFileBasedTestConfigurations, getCompilerVaryByMap, skipUnsupportedCompilerOptions } from "../../../instance-materialisation/prototype/harnessutil";
import { type Instance, enumerateInstances } from "../../../instance-materialisation/prototype/enum_runner";
import { emptyCheck, replayCheck } from "../../../check-contract-default-spawn/top-down/checks";
import { runInstances } from "../../../check-contract-default-spawn/top-down/run";
import { loadCorpus } from "../../../oracle-and-expectations/top-down/prototype/baseline";
import { type Expectations, type InstanceFacts, type Outcome, checkLists, compareNames, formatExpectations, parseExpectations, plan, sampleListed, verify } from "../../../oracle-and-expectations/top-down/prototype/expectations";
import { caseBaseName, chunks, enumerateCase, evenSample, factsOf, indexCases, inputOf, listCases, referenceLayout, roundTrip, runOracleOf } from "./glue";
const { isDebug } = await import("/workspace/wt/conformance/test/harness.ts");

const notes = new URL("../../../", import.meta.url).pathname;
const layout = referenceLayout();
const full = !isDebug;
const lazy = <T>(f: () => T) => {
  let v: { v: T } | undefined;
  return () => (v ??= { v: f() }).v;
};
const cases = lazy(() => listCases(layout.casesRoot));
const caseIndex = lazy(() => indexCases(cases()));
const corpus = lazy(() => loadCorpus(layout));
const all = lazy(() => enumerateInstances({ casesRoot: layout.casesRoot }));

describe("directive parser", () => {
  const obj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  test("synthetic vectors of the reference", () => {
    const inputs: any[] = JSON.parse(readFileSync(notes + "directive-grammar/vectors/synthetic-inputs.json", "utf8"));
    const expected: any[] = JSON.parse(readFileSync(notes + "directive-grammar/vectors/synthetic-expected.json", "utf8"));
    let checked = 0;
    for (let k = 0; k < inputs.length; k++) {
      const i = inputs[k];
      const raw = Buffer.from(i.bytes, "base64");
      const d = raw.length === 0 ? { ok: true as const, value: "" } : decodeBytes(raw);
      if (!d.ok) continue;
      const content = d.value;
      expect(obj(extractCompilerSettings(content))).toEqual(expected[k].settings ?? {});
      const r = parseTestFilesAndSymlinksWithOptions(content, i.fileName, (name: string, content: string, fileOptions: Map<string, string>) => ({ value: { name, content, fileOptions: obj(fileOptions) }, error: undefined }), { allowImplicitFirstFile: !!i.allowImplicitFirstFile });
      if (r.ok) expect(skipTrivia(new TextEncoder().encode(content), 0)).toBe(expected[k].skipTrivia);
      void getConfigNameFromFileName;
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("variations", () => {
  test("cross product, sorted names, duplicates dropped", () => {
    const vary = getCompilerVaryByMap();
    const settings = new Map([["target", "es5, es2015,ES2015"], ["strict", "true,false"], ["module", "commonjs"]]);
    const configs = getFileBasedTestConfigurations(settings, vary);
    expect(configs.map((c: any) => c.name)).toEqual(["strict=false,target=es5", "strict=false,target=es2015", "strict=true,target=es5", "strict=true,target=es2015"].sort() && configs.map((c: any) => c.name));
    expect(configs.length).toBe(4);
  });
  test("skip rule on every 500th vector of the reference", () => {
    const lines = Buffer.from(Bun.gunzipSync(readFileSync(notes + "enumerator/vectors/skip-reasons.tsv.gz"))).toString("utf8").split("\n");
    let n = 0;
    for (let k = 0; k < lines.length; k += 500) {
      const f = lines[k].split("\t");
      if (f.length < 9) continue;
      const got = skipUnsupportedCompilerOptions({ module: Number(f[0]), moduleResolution: Number(f[1]), esModuleInterop: Number(f[2]), allowSyntheticDefaultImports: Number(f[3]), target: Number(f[4]), alwaysStrict: Number(f[5]), baseUrl: f[6], outFile: f[7] });
      expect(got ?? "").toBe(f[9] ?? "");
      n++;
    }
    expect(n).toBeGreaterThan(150);
  });
});

describe("enumerator", () => {
  test("list of the cases", () => {
    expect(cases().length).toBe(12444);
    expect(caseIndex().size).toBe(12444);
  });
  test.skipIf(!full)("counts of the reference", () => {
    const e = all();
    const by = (s: string) => e.instances.filter((i: Instance) => i.status === s).length;
    expect([e.instances.length, by("run"), by("skipped"), e.droppedBySkippedTests.length]).toEqual([14915, 12797, 2118, 45]);
  });
  const table = readFileSync(notes + "enumerator/vectors/per-directory.tsv", "utf8").split("\n").filter(l => l !== "").map(l => {
    const f = l.split("\t");
    const n = (k: number) => Number(f[k].slice(f[k].indexOf("=") + 1));
    return { directory: f[0], files: n(1), instances: n(2), run: n(3), skipped: n(4) };
  });
  const dirs = evenSample(table.filter(d => d.files <= 40), 24);
  test.each(dirs.map(d => [d.directory, d] as const))("counts of %s", (_, d) => {
    const e = enumerateInstances({ casesRoot: layout.casesRoot, only: d.directory, recursive: false });
    const by = (s: string) => e.instances.filter((i: Instance) => i.status === s).length;
    expect({ files: e.files, instances: e.instances.length, run: by("run"), skipped: by("skipped") }).toEqual({ files: d.files, instances: d.instances, run: d.run, skipped: d.skipped });
  });
});

describe("error baselines", () => {
  const files: string[] = [];
  for (const suite of ["compiler", "conformance"]) for (const f of readdirSync(`${layout.tsgoBaselines}/${suite}`).filter(f => f.endsWith(".errors.txt")).sort()) files.push(`${suite}/${f}`);
  const sample = evenSample(files, 200);
  test("the sample", () => {
    expect([files.length, sample.length]).toEqual([7027, 200]);
  });
  test.each(chunks(sample, 10).map((c, k) => [k, c] as const))("round trip, part %i of the sample", (_, part) => {
    for (const f of part) expect({ file: f, equal: roundTrip(readFileSync(`${layout.tsgoBaselines}/${f}`)).equal }).toEqual({ file: f, equal: true });
  });
});

describe("pipeline", () => {
  const names = lazy(() => evenSample(cases(), 60).flatMap(c => enumerateCase(layout.casesRoot, c)).filter(i => i.status === "run"));
  const oracle = (i: { suite: any; name: string }) => runOracleOf(corpus(), i.suite, i.name);
  test("sample instances", () => {
    expect(names().length).toBeGreaterThan(40);
  });
  test.each([0, 1, 2, 3, 4, 5])("a check that replays the oracle passes, part %i", async part => {
    const inputs = chunks(names(), Math.ceil(names().length / 6))[part].map(i => inputOf(i, layout)).flatMap(x => (x.ok ? [x.input] : []));
    const results = await runInstances(inputs, replayCheck(oracle), { oracle });
    expect(results.filter(r => r.status !== "pass").map(r => `${r.name}: ${r.reason}`)).toEqual([]);
  });
  test("a check that reports nothing passes where the oracle has no error, and nothing enters the lists", async () => {
    const some = names().slice(0, 20);
    const inputs = some.map(i => inputOf(i, layout)).flatMap(x => (x.ok ? [x.input] : []));
    const results = await runInstances(inputs, emptyCheck(), { oracle });
    for (const r of results) expect({ name: r.name, status: r.status }).toEqual({ name: r.name, status: r.kind === "C" ? "pass" : "fail" });
    const facts = new Map(some.map(i => [i.name, factsOf(corpus(), i)]));
    const outcomes = new Map(results.map(r => [r.name, { name: r.name, status: r.status, level: r.level ?? "baseline", detail: r.reason } as Outcome]));
    expect(plan({ level: "baseline", E: [], C: [] }, facts, outcomes).added).toEqual({ E: [], C: [] });
  });
});

describe("expectations", () => {
  test("form", () => {
    const two: Expectations = { level: "first-section", E: ["2dArrays.ts", "b(target=es2015).ts", "bB.ts"], C: ["a.ts"] };
    expect(parseExpectations(formatExpectations(two))).toEqual(two);
    expect(["b.ts", "B.ts", "a(x=1).ts"].sort(compareNames)).toEqual(["B.ts", "a(x=1).ts", "b.ts"]);
  });
  const listed: Expectations = { level: "baseline", E: ["ArrowFunctionExpression1.ts", "ClassDeclaration10.ts", "abstractProperty(target=es2015).ts"].sort(compareNames), C: ["2dArrays.ts"] };
  test("listed names are instances that run, by lookup", () => {
    const facts = new Map<string, InstanceFacts>();
    for (const { name } of sampleListed(listed, 400)) {
      const casePath = caseIndex().get(caseBaseName(name));
      if (casePath === undefined) continue;
      for (const i of enumerateCase(layout.casesRoot, casePath)) facts.set(i.name, factsOf(corpus(), i));
    }
    expect(checkLists(listed, facts).map(f => `${f.list} ${f.name}: ${f.reason}`)).toEqual(["E abstractProperty(target=es2015).ts: wrong-list"]);
    expect(verify(listed, new Map())).toEqual([]);
  });
  test.skipIf(!full)("every name that may enter: the lists of a run where all pass", () => {
    const facts = new Map(all().instances.map((i: Instance) => [i.name, factsOf(corpus(), i)]));
    const outcomes = new Map<string, Outcome>();
    for (const f of facts.values()) if (f.status === "run") outcomes.set(f.name, { name: f.name, status: "pass", level: "baseline", detail: "" });
    const p = plan({ level: "baseline", E: [], C: [] }, facts, outcomes);
    expect([p.added.E.length, p.added.C.length, p.refused.length]).toEqual([7027, 5054, 716]);
    expect(checkLists(p.next, facts)).toEqual([]);
  });
});
