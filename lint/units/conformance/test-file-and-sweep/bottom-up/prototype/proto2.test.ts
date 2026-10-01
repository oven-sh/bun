// Research prototype of test/cli/lint/conformance.test.ts, second form: no test above the default limit in a debug build.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractCompilerSettings } from "../../../directive-grammar/prototype/test_case_parser";
import { decodeBytes } from "../../../directive-grammar/prototype/vfs";
import { type Instance, enumerateInstances } from "../../../instance-materialisation/prototype/enum_runner";
import { type CheckInput, type MaterialiseResult, createSpawnCheck, probe, readRun } from "../../../check-contract-default-spawn/top-down/check";
import { emptyCheck, replayCheck } from "../../../check-contract-default-spawn/top-down/checks";
import { type RunResult, runInstances } from "../../../check-contract-default-spawn/top-down/run";
import { loadCorpus } from "../../../oracle-and-expectations/top-down/prototype/baseline";
import { type Expectations, type InstanceFacts, type Outcome, checkLists, compareNames, plan, sampleListed, verify } from "../../../oracle-and-expectations/top-down/prototype/expectations";
import { caseBaseName, chunks, enumerateCase, evenSample, factsOf, indexCases, inputOf, listCases, referenceLayout, roundTrip, runOracleOf } from "./glue";
const { bunEnv, bunExe, isASAN, isDebug, tempDir } = await import("/workspace/wt/conformance/test/harness.ts");

const notes = new URL("../../../", import.meta.url).pathname;
const layout = referenceLayout();
const full = !isDebug;
const slow = process.env.TFS_NO_SLOW ? undefined : isDebug || isASAN ? 120_000 : undefined;
const lazy = <T>(f: () => T) => {
  let v: { v: T } | undefined;
  return () => (v ??= { v: f() }).v;
};
const corpus = lazy(() => loadCorpus(layout));
const caseIndex = lazy(() => indexCases(listCases(layout.casesRoot)));
const oracle = (i: { suite: any; name: string }) => runOracleOf(corpus(), i.suite, i.name);

describe("directive parser", () => {
  test("settings of the synthetic vectors", () => {
    const inputs: any[] = JSON.parse(readFileSync(notes + "directive-grammar/vectors/synthetic-inputs.json", "utf8"));
    const expected: any[] = JSON.parse(readFileSync(notes + "directive-grammar/vectors/synthetic-expected.json", "utf8"));
    const obj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    for (let k = 0; k < inputs.length; k++) {
      const raw = Buffer.from(inputs[k].bytes, "base64");
      const d = raw.length === 0 ? { ok: true as const, value: "" } : decodeBytes(raw);
      if (d.ok) expect(obj(extractCompilerSettings(d.value))).toEqual(expected[k].settings ?? {});
    }
  });
});

describe("enumerator", () => {
  const table = readFileSync(notes + "enumerator/vectors/per-directory.tsv", "utf8").split("\n").filter(l => l !== "").map(l => {
    const f = l.split("\t");
    const n = (k: number) => Number(f[k].slice(f[k].indexOf("=") + 1));
    return { directory: f[0], files: n(1), instances: n(2), run: n(3), skipped: n(4) };
  });
  test.each(evenSample(table.filter(d => d.files <= 40), 24).map(d => [d.directory, d] as const))("instances of %s", (_, d) => {
    const e = enumerateInstances({ casesRoot: layout.casesRoot, only: d.directory, recursive: false });
    const by = (s: string) => e.instances.filter((i: Instance) => i.status === s).length;
    expect({ files: e.files - e.droppedBySkippedTests.length, instances: e.instances.length, run: by("run"), skipped: by("skipped") }).toEqual({ files: d.files, instances: d.instances, run: d.run, skipped: d.skipped });
  }, slow);
  test.skipIf(!full).each(["compiler", "conformance"] as const)("every instance of %s", suite => {
    const e = enumerateInstances({ casesRoot: layout.casesRoot, suites: [suite] });
    const want = table.filter(d => d.directory === suite || d.directory.startsWith(suite + "/")).reduce((a, d) => ({ instances: a.instances + d.instances, run: a.run + d.run }), { instances: 0, run: 0 });
    expect({ instances: e.instances.length, run: e.instances.filter((i: Instance) => i.status === "run").length }).toEqual(want);
  });
});

describe("error baselines", () => {
  const files: string[] = [];
  for (const suite of ["compiler", "conformance"]) for (const f of readdirSync(`${layout.tsgoBaselines}/${suite}`).filter(f => f.endsWith(".errors.txt")).sort()) files.push(`${suite}/${f}`);
  test.each(evenSample(files, 200))("round trip of %s", f => {
    expect(roundTrip(readFileSync(`${layout.tsgoBaselines}/${f}`)).equal).toBe(true);
  }, slow);
});

describe("pipeline", () => {
  const groups = ["conformance/types/tuple", "conformance/moduleResolution/bundler", "conformance/jsx/inline", "conformance/importAssertion", "conformance/directives", "conformance/constEnums"];
  const inputsOf = (directory: string) => enumerateInstances({ casesRoot: layout.casesRoot, only: directory, recursive: false }).instances.filter((i: Instance) => i.status === "run").map((i: Instance) => inputOf(i, layout)).flatMap(x => (x.ok ? [x.input] : []));
  test.each(groups)("a check that replays the oracle passes every instance of %s", async directory => {
    const results = await runInstances(inputsOf(directory), replayCheck(oracle), { oracle });
    expect(results.filter(r => r.status !== "pass").map(r => `${r.name}: ${r.reason}`)).toEqual([]);
    expect(results.length).toBeGreaterThan(5);
  }, slow);
  test("a check that reports nothing passes where the oracle has no error, and nothing enters the lists", async () => {
    const instances = enumerateInstances({ casesRoot: layout.casesRoot, only: "conformance/types/tuple", recursive: false }).instances.filter((i: Instance) => i.status === "run");
    const results = await runInstances(instances.map((i: Instance) => inputOf(i, layout)).flatMap(x => (x.ok ? [x.input] : [])), emptyCheck(), { oracle });
    expect(results.filter(r => (r.status === "pass") !== (r.kind === "C")).map(r => r.name)).toEqual([]);
    const facts = new Map(instances.map((i: Instance) => [i.name, factsOf(corpus(), i)]));
    const outcomes = new Map(results.map(r => [r.name, { name: r.name, status: r.status, level: r.level ?? "baseline", detail: r.reason } as Outcome]));
    expect(plan({ level: "baseline", E: [], C: [] }, facts, outcomes).added).toEqual({ E: [], C: [] });
  }, slow);
});

const fake = (name: string) => [bunExe(), join(notes, "check-contract-default-spawn/top-down/fakes", name)];

describe("default check", () => {
  test.each([
    ["a signal", { exitCode: null, signal: "SIGKILL", stderr: "" }, "crash"],
    ["an exit code that is none of 0, 1 and 2", { exitCode: 7, signal: null, stderr: "" }, "crash"],
    ["the exit code of a refusal", { exitCode: 1, signal: null, stderr: "error: no\n" }, "refusal"],
    ["a line of no form", { exitCode: 0, signal: null, stderr: "Bun has crashed\n" }, "protocol"],
    ["an error and the exit code 0", { exitCode: 0, signal: null, stderr: "/a.ts(1,1): error TS1: x\n" }, "protocol"],
    ["no error and the exit code 2", { exitCode: 2, signal: null, stderr: "" }, "protocol"],
  ] as const)("never an empty list: %s", (_, run, failure) => {
    const r = readRun({ timedOut: false, stdout: "", ...run } as any);
    expect(r.ok ? "diagnostics" : r.failure.failure).toBe(failure);
  });
  const linter = lazy(() => createSpawnCheck({ command: fake("lints.ts"), env: bunEnv }));
  let made = 0;
  const synthetic = (below: string, name: string, content: string): CheckInput => {
    const root = `${below}/${made++}`;
    return {
      name, suite: "compiler", casePath: name, configuration: {}, compilerOptions: {}, defaultOptions: {}, captureSuggestions: false, useCaseSensitiveFileNames: true,
      currentDirectory: "/.src", configFile: undefined, roots: [{ name: "/.src/" + name, content }], otherFiles: [], rootNames: ["/.src/" + name], links: [], includeLibDirectory: false,
      materialise(): MaterialiseResult {
        mkdirSync(dirname(`${root}/.src/${name}`), { recursive: true });
        writeFileSync(`${root}/.src/${name}`, content);
        return { ok: true, value: { root, currentDirectory: root + "/.src", rootNames: [`${root}/.src/${name}`], toReal: v => root + v, toVirtual: p => (p.startsWith(root + "/") ? p.slice(root.length) : undefined), mapText: t => t.replaceAll(root, "") } };
      },
    };
  };
  test.concurrent("the probe refuses a command that runs its operand", async () => {
    expect(await probe({ command: fake("runs.ts"), env: bunEnv })).toEqual({ ok: false, reason: "the command ran the file that it was to check" });
  }, slow);
  test.concurrent("a command that lints: the operands are the roots and stderr is read", async () => {
    using dir = tempDir("lint-conformance-proto", {});
    const inputs = [
      synthetic(String(dir), "a.ts", "//~ print {file}(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n"),
      synthetic(String(dir), "c.ts", "const x: number = 1;\n"),
      synthetic(String(dir), "k.ts", "//~ kill SIGKILL\n"),
    ];
    const results = await runInstances(inputs, linter(), { oracle: () => ({ kind: "C" }), concurrency: 3, loose: true });
    expect(results.map((r: RunResult) => [r.name, r.status, r.loose?.equal])).toEqual([["a.ts", "unsupported", false], ["c.ts", "unsupported", true], ["k.ts", "error", undefined]]);
  }, slow);
});

describe("listed instances", () => {
  const listed: Expectations = { level: "baseline", E: ["ArrowFunctionExpression1.ts", "ClassDeclaration10.ts", "abstractPropertyNegative(target=es2015).ts", "castingTuple.ts"].sort(compareNames), C: ["2dArrays.ts"] };
  const factsFor = (names: readonly string[]) => {
    const facts = new Map<string, InstanceFacts>();
    const instances = new Map<string, Instance>();
    for (const name of names) {
      const casePath = caseIndex().get(caseBaseName(name));
      if (casePath === undefined) continue;
      for (const i of enumerateCase(layout.casesRoot, casePath)) {
        facts.set(i.name, factsOf(corpus(), i));
        instances.set(i.name, i);
      }
    }
    return { facts, instances };
  };
  test("every name is an instance that runs, of the kind of its list", () => {
    const names = sampleListed(listed, 400).map(n => n.name);
    expect(checkLists(listed, factsFor(names).facts).map(f => `${f.list} ${f.name}: ${f.reason}`)).toEqual([]);
  }, slow);
  test.each(chunks(sampleListed(listed, 400), isDebug ? 4 : 50).map((b, k) => [k + 1, b] as const))("batch %i passes", async (_, batch) => {
    const { instances } = factsFor(batch.map(n => n.name));
    const inputs = batch.map(n => inputOf(instances.get(n.name)!, layout)).flatMap(x => (x.ok ? [x.input] : []));
    const results = await runInstances(inputs, replayCheck(oracle), { oracle, concurrency: 4 });
    const outcomes = new Map(results.map(r => [r.name, { name: r.name, status: r.status, level: r.level ?? "baseline", detail: r.reason } as Outcome]));
    expect(verify(listed, outcomes).map(f => `${f.list} ${f.name}: ${f.reason}: ${f.detail}`)).toEqual([]);
    expect(outcomes.size).toBe(batch.length);
  }, slow);
});

describe("sweep", () => {
  test.concurrent("one directory: the tables and the report", async () => {
    using dir = tempDir("lint-conformance-sweep-proto", {});
    await using proc = Bun.spawn({ cmd: [bunExe(), join(import.meta.dir, "sweep_proto.ts"), "--check", "empty", "--report", join(String(dir), "report.json"), "conformance/types/tuple/"], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("E (the oracle has errors): 0/20 pass. C (the oracle has none): 7/7 pass.");
    expect(JSON.parse(readFileSync(join(String(dir), "report.json"), "utf8")).totals.run).toBe(27);
    expect(exitCode).toBe(0);
  }, slow);
});
