// Research prototype of test/cli/lint/conformance.test.ts, wired to the prototypes of the first wave and to the reference clone.
// In the repository: "harness" for the absolute import, "./conformance/runner" for "./index", the committed corpus for referenceLayout().
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { getConfigNameFromFileName } from "../../directive-grammar/prototype/harnessutil";
import { skipTrivia } from "../../directive-grammar/prototype/scanner";
import * as directives from "../../directive-grammar/prototype/test_case_parser";
import { decodeBytes } from "../../directive-grammar/prototype/vfs";
import {
  getCompilerVaryByMap,
  getFileBasedTestConfigurations,
  HarnessFatal,
} from "../../instance-materialisation/prototype/harnessutil";
import { extractCompilerSettings } from "../../instance-materialisation/prototype/test_case_parser";
import {
  type CheckInput,
  type Expectations,
  type InstanceFacts,
  type Outcome,
  caseBaseName,
  checkLists,
  createSpawnCheck,
  emptyCheck,
  enumerateCase,
  enumerateInstances,
  factsOf,
  formatExpectations,
  indexCases,
  inputOf,
  loadCorpus,
  parseExpectations,
  plan,
  referenceLayout,
  replayCheck,
  roundTrip,
  runInstances,
  runOracleOf,
  sampleListed,
  tscRules,
  tsgoRules,
  verify,
} from "./index";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "/workspace/wt/conformance/test/harness.ts";

const notes = join(import.meta.dir, "..", "..");
const layout = referenceLayout();
// Two switches of the prototype alone: other lists, and the check that replays the oracle in place of the binary.
const expectationsPath = process.env.TFS_EXPECTATIONS ?? join(import.meta.dir, "expectations.json");
const replay = process.env.TFS_CHECK === "replay";
const fakeLinter = join(notes, "check-contract-default-spawn", "top-down", "fakes", "lints.ts");

// A debug or sanitizer build runs this file's JavaScript about a hundred times slower: it takes the samples and leaves the whole corpus to release builds.
const small = isDebug || isASAN;

// One of every n paths, the same on every platform and without an order of the directory entries.
const sampled = (path: string, n: number) => Bun.hash.crc32(path) % n === 0;

// Groups of at most n: a debug build gets through one group within the time of one test.
function groupsOf<T>(all: readonly T[], n: number, weight: (x: T) => number = () => 1): T[][] {
  const out: T[][] = [];
  let sum = Infinity;
  for (const x of all) {
    if (sum + weight(x) > n) {
      out.push([]);
      sum = 0;
    }
    out[out.length - 1].push(x);
    sum += weight(x);
  }
  return out;
}

let index: Map<string, string> | undefined;
const cases = () => (index ??= indexCases(layout.casesRoot));
let corpusOnce: ReturnType<typeof loadCorpus> | undefined;
const corpus = () => (corpusOnce ??= loadCorpus(layout));
let referenceText: string | undefined;
// The subtests of TestSubmodule of the reference run, one line each: "PASS" or "SKIP", a tab, the name that Go prints.
const referenceSubtests = () =>
  (referenceText ??=
    "\n" +
    gunzipSync(
      readFileSync(join(notes, "oracle-and-expectations", "bottom-up", "vectors", "go-subtests.tsv.gz")),
    ).toString("utf8"));
const referenceStatus = (name: string) =>
  referenceSubtests().includes(`\nPASS\t${name}\n`)
    ? "run"
    : referenceSubtests().includes(`\nSKIP\t${name}\n`)
      ? "skipped"
      : "no subtest of the reference";
const goName = (testName: string) => testName.replaceAll(" ", "_");
// Two of the 14 baselines in the pretty form: one with related information, one with tabs.
const pretty = new Set(["deeplyNestedAssignabilityIssue.errors.txt", "prettyFileWithErrorsAndTabs.errors.txt"]);

describe("corpus", () => {
  test("holds the cases and the baselines of the pinned commits", () => {
    const c = corpus();
    expect({
      cases: cases().size,
      tsgoCompiler: c.tsgo.get("compiler")!.size,
      tsgoConformance: c.tsgo.get("conformance")!.size,
      accepted: c.accepted.size,
      triaged: c.triaged.size,
      postEmitOrder: c.postEmitOrder.size,
    }).toEqual({
      cases: 12444,
      tsgoCompiler: 3187,
      tsgoConformance: 3840,
      accepted: 1163,
      triaged: 2,
      postEmitOrder: 3,
    });
  });
});

describe("directives", () => {
  const inputs: any[] = JSON.parse(
    readFileSync(join(notes, "directive-grammar", "vectors", "synthetic-inputs.json"), "utf8"),
  );
  const expected: any[] = JSON.parse(
    readFileSync(join(notes, "directive-grammar", "vectors", "synthetic-expected.json"), "utf8"),
  );
  const obj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  test("the vectors of the reference parser", () => {
    const got = inputs.map(i => {
      const raw = Buffer.from(i.bytes, "base64");
      const d = raw.length === 0 ? { ok: true as const, value: "" } : decodeBytes(raw);
      if (!d.ok) return { name: i.name, refused: d.reason };
      const content = d.value;
      const bytes = new TextEncoder().encode(content);
      const o: any = {
        name: i.name,
        decoded: content,
        lines: content.split(/\r?\n/),
        settings: obj(directives.extractCompilerSettings(content)),
        panic: "",
        units: [],
        configUnit: null,
        symlinks: {},
        currentDirectory: "",
        globalOptions: {},
        skipTrivia: skipTrivia(bytes, 0),
        error: "",
        decodedByteLen: bytes.length,
      };
      const failOn = i.failOn ?? "";
      const r = directives.parseTestFilesAndSymlinksWithOptions(
        content,
        i.fileName,
        (name, content, fileOptions) =>
          failOn !== "" && name === failOn
            ? {
                value: { name: "FAILED:" + name, content, fileOptions: obj(fileOptions) },
                error: "cannot parse " + name,
              }
            : { value: { name, content, fileOptions: obj(fileOptions) }, error: undefined },
        { allowImplicitFirstFile: !!i.allowImplicitFirstFile },
      );
      if (!r.ok) o.panic = r.reason;
      else {
        let units = r.value.units;
        o.error = r.value.error ?? "";
        o.symlinks = obj(r.value.symlinks);
        o.currentDirectory = r.value.currentDirectory;
        o.globalOptions = obj(r.value.globalOptions);
        if (!i.allowImplicitFirstFile) {
          const k = units.findIndex((u: any) => getConfigNameFromFileName(u.name) !== "");
          if (k >= 0) {
            o.configUnit = units[k];
            units = units.filter((_: unknown, x: number) => x !== k);
          }
        }
        o.units = units;
      }
      return o;
    });
    // The port refuses bytes that are no UTF-8; the reference reads them as they are.
    const refused = got.filter(o => "refused" in o).map(o => o.name);
    expect(refused).toEqual(["decode: one byte 0xFF", "decode: two bytes of a utf-8 BOM"]);
    expect(got.filter(o => !("refused" in o))).toEqual(expected.filter(o => !refused.includes(o.name)));
    expect(inputs.length).toBe(120);
  });
});

describe("variations", () => {
  const vary = getCompilerVaryByMap();
  const names = (text: string) => getFileBasedTestConfigurations(extractCompilerSettings(text), vary).map(c => c.name);

  test.each([
    ["no setting", "let x;\n", []],
    ["one value", "// @target: es2015\n", [""]],
    ["two values", "// @target: es5, es2015\n", ["target=es5", "target=es2015"]],
    ["a value twice", "// @strict: true, true, false\n", ["strict=true", "strict=false"]],
    [
      "the cross product, keys sorted in the name",
      "// @target: es5,esnext\n// @strict: true,false\n",
      ["strict=true,target=es5", "strict=false,target=es5", "strict=true,target=esnext", "strict=false,target=esnext"],
    ],
    ["the last occurrence wins", "// @strict: true, false\n// @strict: false\n", [""]],
    ["every value", "// @strict: *\n", ["strict=true", "strict=false"]],
    ["every value but one leaves nothing to vary", "// @strict: *, -false\n", [""]],
    ["a name in upper case", "// @STRICT: true, false\n", ["strict=true", "strict=false"]],
    ["an option that does not vary", "// @lib: es5, dom\n", [""]],
  ] as [string, string, string[]][])("%s", (_label, text, want) => {
    expect(names(text)).toEqual(want);
  });

  test("a set of variations that is empty or too large stops the case", () => {
    expect(() => names("// @strict: -true, -false, *\n")).toThrow(HarnessFatal);
    expect(() =>
      names(
        "// @strict: true,false\n// @noEmit: true,false\n// @declaration: true,false\n// @alwaysStrict: true,false\n// @noImplicitAny: true,false\n",
      ),
    ).toThrow("exceeded the maximum number of variations");
  });
});

describe("enumerator", () => {
  const sample = [...cases().values()].filter(path => sampled(path, 40)).sort();

  test("the sample holds cases of both suites", () => {
    expect({
      compiler: sample.filter(p => p.startsWith("compiler/")).length > 100,
      conformance: sample.filter(p => p.startsWith("conformance/")).length > 100,
    }).toEqual({ compiler: true, conformance: true });
  });

  test.each(groupsOf(sample, 40).map((g, k) => [k + 1, g] as const))(
    "the instances of one of 40 cases are the subtests of the reference: group %d",
    (_k, group) => {
      const got: string[] = [];
      const want: string[] = [];
      for (const path of group) {
        for (const i of enumerateCase(layout.casesRoot, path)) {
          got.push(`${goName(i.testName)} ${i.status}`);
          want.push(`${goName(i.testName)} ${referenceStatus(goName(i.testName))}`);
        }
      }
      expect(got).toEqual(want);
    },
  );

  // The whole corpus is a second of work in a release build and minutes in a debug build; the time limit is for a machine under load.
  test.skipIf(small)(
    "every instance is a subtest of the reference, with its status",
    () => {
      const e = enumerateInstances({ casesRoot: layout.casesRoot });
      const ref = new Map<string, string>();
      for (const line of referenceSubtests().split("\n")) if (line !== "") ref.set(line.slice(5), line.slice(0, 4));
      const got = new Map(
        e.instances.map(i => [
          goName(i.testName),
          i.status === "run" ? "PASS" : i.status === "skipped" ? "SKIP" : i.status,
        ]),
      );
      const differ: string[] = [];
      for (const [name, status] of got)
        if (ref.get(name) !== status) differ.push(`${name}: ${status}, the reference has ${ref.get(name)}`);
      for (const name of ref.keys()) if (!got.has(name)) differ.push(`${name}: missing`);
      expect(differ).toEqual([]);
      const reasons: Record<string, number> = {};
      for (const i of e.instances)
        if (i.status !== "run")
          reasons[i.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1")] =
            (reasons[i.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1")] ?? 0) + 1;
      const c = corpus();
      const facts = e.instances.map(i => factsOf(c, i));
      const count = (f: (i: InstanceFacts) => boolean) => facts.filter(f).length;
      expect({
        files: e.files,
        droppedByName: e.droppedBySkippedTests.length,
        instances: e.instances.length,
        run: count(i => i.status === "run"),
        skipped: count(i => i.status === "skipped"),
        E: count(i => i.kind === "E"),
        C: count(i => i.kind === "C"),
        compilerE: count(i => i.kind === "E" && i.casePath.startsWith("compiler/")),
        conformanceE: count(i => i.kind === "E" && i.casePath.startsWith("conformance/")),
        accepted: count(i => i.tags.includes("accepted")),
        triaged: count(i => i.tags.includes("triaged")),
        reasons,
      }).toEqual({
        files: 12444,
        droppedByName: 45,
        instances: 14915,
        run: 12797,
        skipped: 2118,
        E: 7027,
        C: 5770,
        compilerE: 3187,
        conformanceE: 3840,
        accepted: 442,
        triaged: 2,
        reasons: {
          "unsupported target ES5": 1244,
          "unsupported module kind AMD": 321,
          "unsupported module kind System": 222,
          "unsupported outFile": 87,
          "unsupported module resolution kind 1": 57,
          "unsupported module kind UMD": 57,
          "alwaysStrict=false is unsupported": 52,
          "unsupported baseUrl": 31,
          "esModuleInterop=false is unsupported": 24,
          "unsupported module resolution kind 2": 23,
        },
      });
    },
    30_000,
  );
});

describe("error baselines", () => {
  // One of 48 files of TypeScript, as many of typescript-go as the overlay of the corpus gives, and two files in the pretty form.
  const c = corpus();
  const tsDirectory = layout.casesRoot.replace(/cases$/, "baselines/reference");
  const files: { path: string; rules: typeof tsgoRules; bytes: number }[] = [];
  // A file above 64 KB stays out: a debug build needs seconds for it, and the sweep reads every file.
  const add = (path: string, rules: typeof tsgoRules) => {
    const bytes = statSync(path).size;
    if (bytes <= 64 * 1024) files.push({ path, rules, bytes });
  };
  for (const suite of ["compiler", "conformance"] as const) {
    for (const name of c.tsgo.get(suite)!)
      if (sampled(name, 500) || pretty.has(name)) add(`${layout.tsgoBaselines}/${suite}/${name}`, tsgoRules);
  }
  for (const name of readdirSync(tsDirectory)) {
    if (name.endsWith(".errors.txt") && (sampled(name, 48) || pretty.has(name)))
      add(`${tsDirectory}/${name}`, tscRules);
  }

  test("the sample holds about 200 files, of both tools", () => {
    expect({
      tsgo: files.filter(f => f.rules === tsgoRules).length > 5,
      ts: files.filter(f => f.rules === tscRules).length > 150,
      all: files.length < 260,
    }).toEqual({ tsgo: true, ts: true, all: true });
  });

  test.each(groupsOf(files, 48 * 1024, f => f.bytes).map((g, k) => [k + 1, g] as const))(
    "read and written again, the bytes are the same: group %d",
    (_k, group) => {
      const differ: string[] = [];
      let prettyFiles = 0;
      for (const f of group) {
        const r = roundTrip(readFileSync(f.path), f.rules);
        if (!r.equal) differ.push(f.path);
        if (r.pretty) prettyFiles++;
      }
      expect(differ).toEqual([]);
      expect(prettyFiles).toBe(group.filter(f => pretty.has(f.path.slice(f.path.lastIndexOf("/") + 1))).length);
    },
  );
});

describe("runner", () => {
  const sample = [...cases().values()].filter(path => sampled(path, 250)).sort();
  const oracle = (i: CheckInput) => runOracleOf(corpus(), i.suite, i.name);
  const seen = { E: 0, C: 0 };

  test.each(groupsOf(sample, 8).map((g, k) => [k + 1, g] as const))(
    "replayed oracles pass and a check that reports nothing passes no instance with errors: group %d",
    async (_k, group) => {
      const inputs: CheckInput[] = [];
      for (const path of group) {
        for (const i of enumerateCase(layout.casesRoot, path)) {
          if (i.status !== "run") continue;
          const r = inputOf(i, { layout });
          if (r.ok) inputs.push(r.input);
        }
      }
      const replayed = await runInstances(inputs, replayCheck(oracle), { oracle });
      expect(replayed.map(r => `${r.name}: ${r.status} ${r.level} ${r.reason}`)).toEqual(
        inputs.map(i => `${i.name}: pass baseline `),
      );
      const silent = await runInstances(inputs, emptyCheck(), { oracle });
      expect(silent.map(r => `${r.name}: ${r.kind} ${r.status}`)).toEqual(
        inputs.map(i => `${i.name}: ${oracle(i).kind === "E" ? "E fail" : "C pass"}`),
      );
      for (const i of inputs) seen[oracle(i).kind]++;
    },
  );

  test("the sample had instances with errors and without", () => {
    expect({ E: seen.E > 10, C: seen.C > 10 }).toEqual({ E: true, C: true });
  });
});

describe("expectations", () => {
  const facts = new Map<string, InstanceFacts>(
    [
      ["e1.ts", "E"],
      ["e2(strict=true).ts", "E"],
      ["c1.ts", "C"],
    ].map(([name, kind]) => [
      name,
      {
        name,
        directory: "compiler",
        casePath: "compiler/" + caseBaseName(name),
        status: "run",
        reason: "",
        kind: kind as "E" | "C",
        tags: [],
        platformLimited: undefined,
      },
    ]),
  );
  const outcomes = (status: Outcome["status"]) =>
    new Map<string, Outcome>(
      [...facts.keys()].map(name => [
        name,
        { name, status, level: "baseline", detail: status === "pass" ? "" : "line 1" },
      ]),
    );
  const empty: Expectations = { level: "baseline", E: [], C: [] };

  test("the file has one form", () => {
    const x: Expectations = { level: "baseline", E: ["e1.ts", "e2(strict=true).ts"], C: ["c1.ts"] };
    expect(formatExpectations(x)).toBe(
      '{\n  "level": "baseline",\n  "E": [\n    "e1.ts",\n    "e2(strict=true).ts"\n  ],\n  "C": [\n    "c1.ts"\n  ]\n}\n',
    );
    expect(parseExpectations(formatExpectations(x))).toEqual(x);
    expect(() => parseExpectations(formatExpectations({ ...x, E: ["e2(strict=true).ts", "e1.ts"] }))).toThrow(
      "comes after",
    );
    expect(() => parseExpectations(JSON.stringify(x))).toThrow("form");
  });

  test("a listed name that does not pass is a failure, and a name that passes enters and never leaves", () => {
    const listed: Expectations = { level: "baseline", E: ["e1.ts"], C: [] };
    expect(verify(listed, outcomes("pass"))).toEqual([]);
    expect(verify(listed, outcomes("fail")).map(f => [f.name, f.list, f.reason])).toEqual([["e1.ts", "E", "fail"]]);
    const grown = plan(empty, facts, outcomes("pass"));
    expect(grown.added).toEqual({ E: ["e1.ts", "e2(strict=true).ts"], C: ["c1.ts"] });
    expect(plan(grown.next, facts, outcomes("fail")).next).toEqual(grown.next);
    expect(
      checkLists({ level: "baseline", E: ["c1.ts", "gone.ts"], C: [] }, facts).map(f => [f.name, f.reason]),
    ).toEqual([
      ["c1.ts", "wrong-list"],
      ["gone.ts", "not-an-instance"],
    ]);
  });
});

describe("default check", () => {
  // Three processes of the binary under test: a debug build needs more than the default time for them.
  test(
    "a command that lints gets the roots of a written instance as operands",
    async () => {
      using dir = tempDir("lint-conformance", {});
      const path = cases().get("2dArrays.ts")!;
      const [instance] = enumerateCase(layout.casesRoot, path);
      const r = inputOf(instance, { layout, materialiseBelow: String(dir) });
      if (!r.ok) throw new Error(r.reason);
      const check = createSpawnCheck({ command: [bunExe(), fakeLinter], env: bunEnv });
      const [result] = await runInstances([r.input], check, {
        oracle: i => runOracleOf(corpus(), i.suite, i.name),
        loose: true,
      });
      expect({
        name: result.name,
        kind: result.kind,
        status: result.status,
        reason: result.reason,
        loose: result.loose,
      }).toEqual({
        name: "2dArrays.ts",
        kind: "C",
        status: "unsupported",
        reason: "the run did not have the options of the instance",
        loose: { equal: true, reason: "" },
      });
    },
    small ? 60_000 : undefined,
  );
});

describe("expectations.json", () => {
  const text = readFileSync(expectationsPath, "utf8");
  const lists = parseExpectations(text);
  // A debug or sanitizer build starts a process in about a second: it runs a sample of the lists, a release build runs them all.
  const listed = sampleListed(lists, small ? 16 : Infinity);
  const check = replay
    ? replayCheck(i => runOracleOf(corpus(), i.suite, i.name))
    : createSpawnCheck({ command: [bunExe()], env: bunEnv });
  const instanceOf = (name: string) => {
    const path = cases().get(caseBaseName(name));
    return path === undefined ? undefined : enumerateCase(layout.casesRoot, path).find(i => i.name === name);
  };

  test("is in the form that the update writes", () => {
    expect(formatExpectations(lists)).toBe(text);
  });

  test.each(groupsOf(listed, 400).map((g, k) => [k + 1, g] as const))(
    "lists run instances of the kind of their list: group %d",
    (_k, group) => {
      const c = corpus();
      const facts = new Map<string, InstanceFacts>();
      for (const { name } of group) {
        const instance = instanceOf(name);
        if (instance !== undefined) facts.set(name, factsOf(c, instance));
      }
      const part: Expectations = {
        level: lists.level,
        E: group.filter(n => n.list === "E").map(n => n.name),
        C: group.filter(n => n.list === "C").map(n => n.name),
      };
      expect(checkLists(part, facts)).toEqual([]);
    },
  );

  // One batch at a time: a batch keeps as many processes in flight as it may, and a second batch beside it would double them.
  test.each(groupsOf(listed, small ? 8 : 64).map((g, k) => [k + 1, g] as const))(
    "every listed instance passes: batch %d",
    async (_k, batch) => {
      using dir = tempDir("lint-conformance", {});
      const c = corpus();
      const inputs: CheckInput[] = [];
      const failures: { name: string; status: string; detail: string }[] = [];
      for (const { name } of batch) {
        const instance = instanceOf(name);
        const r = instance?.status === "run" ? inputOf(instance, { layout, materialiseBelow: String(dir) }) : undefined;
        if (r?.ok) inputs.push(r.input);
        else
          failures.push({ name, status: "error", detail: r === undefined ? "no run instance of this name" : r.reason });
      }
      const results = await runInstances(inputs, check, {
        oracle: i => runOracleOf(c, i.suite, i.name),
        concurrency: Math.min(8, availableParallelism()),
        timeoutMs: small ? 60_000 : 10_000,
      });
      const outcomes = new Map<string, Outcome>(
        results.map(r => [
          r.name,
          { name: r.name, status: r.status, level: r.level ?? lists.level, detail: r.diff ?? r.reason },
        ]),
      );
      for (const f of verify(lists, outcomes)) failures.push({ name: f.name, status: f.reason, detail: f.detail });
      // The first failures in full and the number of all: a binary that cannot lint fails every name for one reason.
      expect({ failed: failures.length, first: failures.slice(0, 5) }).toEqual({ failed: 0, first: [] });
    },
    small ? 120_000 : 30_000,
  );
});
