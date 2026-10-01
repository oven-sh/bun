// Research prototype of runner/index.ts: the one module that conformance.test.ts and sweep.ts import.
// Every name below is re-exported from a prototype of the first wave or is glue that the runner has to own.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import type {
  CheckInput,
  CompilerOptionValue,
  MaterialiseResult,
} from "../../check-contract-default-spawn/top-down/check";
import type { Oracle as RunOracle } from "../../check-contract-default-spawn/top-down/run";
import { type Rules, tsgoRules } from "../../error-baseline-format/top-down/diagnosticwriter";
import { getErrorBaseline } from "../../error-baseline-format/top-down/error_baseline";
import { readErrorBaseline } from "../../error-baseline-format/top-down/reader";
import { buildHarnessFs, newCompilerTest } from "../../instance-materialisation/prototype/compiler_test";
import {
  type Instance,
  type Suite,
  enumerateFiles,
  getCompilerFileBasedTest,
  getConfiguredName,
  getStatus,
  skippedEmitTests,
  skippedTests,
} from "../../instance-materialisation/prototype/enum_runner";
import { type Platform, materialise, probePlatform } from "../../instance-materialisation/prototype/materialize";
import { readFile } from "../../instance-materialisation/prototype/readfile";
import {
  type Corpus,
  type CorpusPaths,
  oracleOf,
  readOracle,
  tagsOf,
} from "../../oracle-and-expectations/top-down/prototype/baseline";
import type { InstanceFacts } from "../../oracle-and-expectations/top-down/prototype/expectations";

export { checkOf, createSpawnCheck, failure, probe } from "../../check-contract-default-spawn/top-down/check";
export type { Check, CheckInput, CheckOutput } from "../../check-contract-default-spawn/top-down/check";
export { emptyCheck, plainReplayCheck, replayCheck } from "../../check-contract-default-spawn/top-down/checks";
export { parsePlainDiagnostics } from "../../check-contract-default-spawn/top-down/plain";
export { runInstances } from "../../check-contract-default-spawn/top-down/run";
export type { RunResult } from "../../check-contract-default-spawn/top-down/run";
export { tscRules, tsgoRules, WriterPanic } from "../../error-baseline-format/top-down/diagnosticwriter";
export { getErrorBaseline } from "../../error-baseline-format/top-down/error_baseline";
export { ReadError, readErrorBaseline } from "../../error-baseline-format/top-down/reader";
export { toErrorBaseline, toWriterInput } from "../../error-baseline-format/top-down/shape";
export type { Diagnostic } from "../../error-baseline-format/top-down/shape";
export { enumerateFiles, enumerateInstances, skippedTests } from "../../instance-materialisation/prototype/enum_runner";
export type { Instance, Suite } from "../../instance-materialisation/prototype/enum_runner";
export { loadCorpus, oracleOf, readOracle, tagsOf } from "../../oracle-and-expectations/top-down/prototype/baseline";
export type { Corpus } from "../../oracle-and-expectations/top-down/prototype/baseline";
export {
  checkLists,
  compareNames,
  compareWithRevision,
  ExpectationsError,
  formatExpectations,
  overQuota,
  parseExpectations,
  plan,
  reportText,
  sampleListed,
  verify,
} from "../../oracle-and-expectations/top-down/prototype/expectations";
export type {
  Expectations,
  Failure,
  InstanceFacts,
  Kind,
  Level,
  Outcome,
} from "../../oracle-and-expectations/top-down/prototype/expectations";
export {
  parseSweepArgs,
  select,
  updateCommand,
  usage,
  UsageError,
} from "../../oracle-and-expectations/top-down/prototype/sweep_args";
export type { SweepOptions } from "../../oracle-and-expectations/top-down/prototype/sweep_args";

const reference = process.env.TSGO ?? "/workspace/ref/typescript-go";

export interface Layout extends CorpusPaths {
  casesRoot: string;
  libRoot: string;
}

// The layout of the reference clone on disk. The committed corpus gives the same fields from its own directories.
export function referenceLayout(root = reference): Layout {
  const ts = root + "/_submodules/TypeScript";
  return {
    casesRoot: ts + "/tests/cases",
    libRoot: ts + "/tests/lib",
    tsgoBaselines: root + "/testdata/baselines/reference/submodule",
    tsBaselines: undefined,
    expectsNoErrors: undefined,
    accepted: root + "/testdata/submoduleAccepted.txt",
    triaged: root + "/testdata/submoduleTriaged.txt",
    postEmitOrder: new URL("../../oracle-and-expectations/top-down/vectors/post-emit-order.txt", import.meta.url)
      .pathname,
  };
}

// Paths of the cases below the cases directory, in the order of the reference: compiler, then conformance.
export function listCases(casesRoot: string): string[] {
  const out: string[] = [];
  for (const suite of ["compiler", "conformance"]) {
    for (const p of enumerateFiles(casesRoot + "/" + suite, true)) out.push(p.slice(casesRoot.length + 1));
  }
  return out;
}

// Base name of a case to its path, from the names of the directories alone: no file is read and nothing is sorted.
export function indexCases(casesRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    for (const entry of readdirSync(casesRoot + "/" + rel, { withFileTypes: true })) {
      const path = rel + "/" + entry.name;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) out.set(entry.name, path);
    }
  };
  walk("compiler");
  walk("conformance");
  return out;
}

// "a(target=es2015).ts" is an instance of the case "a.ts".
export function caseBaseName(instanceName: string): string {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(instanceName);
  return m === null ? instanceName : m[1] + m[3];
}

// The instances of one case: the body of the loop of enumerateInstances.
export function enumerateCase(casesRoot: string, casePath: string): Instance[] {
  const filename = casesRoot + "/" + casePath;
  const basename = casePath.slice(casePath.lastIndexOf("/") + 1);
  const suite = casePath.slice(0, casePath.indexOf("/")) as Suite;
  if (skippedTests.includes(basename)) return [];
  const invalid = (reason: string): Instance[] => [
    {
      name: basename,
      testName: basename,
      suite,
      casePath,
      configName: "",
      config: undefined,
      status: "invalid",
      reason,
      kind: undefined,
      tags: [],
    },
  ];
  const read = readFile(filename);
  if (!read.ok) return invalid("Could not read test file: " + filename);
  const test = getCompilerFileBasedTest(read.contents);
  if (test.fatal !== undefined) return invalid(test.fatal);
  const out: Instance[] = [];
  for (const config of test.configurations.length > 0 ? test.configurations : [undefined]) {
    const configName = config?.name ?? "";
    const st = getStatus(read.contents, filename, config?.config);
    out.push({
      name: getConfiguredName(basename, configName),
      testName: configName !== "" ? basename + " " + configName : basename,
      suite,
      casePath,
      configName,
      config: config?.config,
      status: st.status,
      reason: st.reason,
      kind: undefined,
      tags: skippedEmitTests.has(basename) ? ["skipped-emit"] : [],
    });
  }
  return out;
}

export function factsOf(corpus: Corpus, i: Instance): InstanceFacts {
  const run = i.status === "run";
  return {
    name: i.name,
    directory: i.casePath.slice(0, i.casePath.lastIndexOf("/")),
    casePath: i.casePath,
    status: i.status,
    reason: i.reason,
    kind: run ? oracleOf(corpus, i.suite, i.name).kind : undefined,
    tags: run ? tagsOf(corpus, i.suite, i.name) : [],
    platformLimited: undefined,
  };
}

export function runOracleOf(corpus: Corpus, suite: Suite, name: string): RunOracle {
  const o = oracleOf(corpus, suite, name);
  if (o.kind === "C") return { kind: "C" };
  return { kind: "E", bytes: readOracle(o)!, path: o.path! };
}

const harnessNames = new Set([
  "usecasesensitivefilenames",
  "baselinefile",
  "includebuiltfile",
  "filename",
  "libfiles",
  "noimplicitreferences",
  "currentdirectory",
  "symlink",
  "link",
  "notypesandsymbols",
  "fullemitpaths",
  "reportdiagnostics",
  "capturesuggestions",
  "typescriptversion",
]);

const libFilesOf = new Map<string, Map<string, Uint8Array>>();
function testLibFiles(libRoot: string): Map<string, Uint8Array> {
  let files = libFilesOf.get(libRoot);
  if (files !== undefined) return files;
  files = new Map();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = dir + "/" + name;
      if (lstatSync(p).isDirectory()) walk(p, rel + "/" + name);
      else files!.set("/.lib" + rel + "/" + name, readFileSync(p));
    }
  };
  walk(libRoot, "");
  libFilesOf.set(libRoot, files);
  return files;
}

export interface InputOptions {
  layout: Layout;
  // Directory below which each instance gets a directory of its own. Absent: the instance cannot be written.
  materialiseBelow?: string;
}

let platform: Platform | undefined;
let made = 0;

export type InputResult = { ok: true; input: CheckInput } | { ok: false; status: string; reason: string };

// What a check gets for one run instance: its files, its options and the way to write it to disk.
export function inputOf(inst: Instance, options: InputOptions): InputResult {
  const file = options.layout.casesRoot + "/" + inst.casePath;
  const content = readFile(file).contents;
  const config = inst.config === undefined ? undefined : new Map(inst.config);
  const r = newCompilerTest(content, file, config);
  if (!r.ok) return { ok: false, status: r.status, reason: r.reason };
  const t = r.value;
  const configuration: Record<string, string> = {};
  for (const [k, v] of [...(config ?? new Map<string, string>())].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
    configuration[k] = v;
  const ucsfn = (configuration["usecasesensitivefilenames"] ?? "true").toLowerCase() !== "false";
  const libNames = (configuration["libfiles"] ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(s => s !== "");
  const noLib = (configuration["nolib"] ?? "").toLowerCase() === "true";
  const fsx = buildHarnessFs(t, { libFiles: libNames, noLib, useCaseSensitiveFileNames: ucsfn });
  const compilerOptions: Record<string, CompilerOptionValue> = { noErrorTruncation: true };
  for (const [k, v] of Object.entries(configuration)) if (!harnessNames.has(k)) compilerOptions[k] = v;
  const id = made++;
  return {
    ok: true,
    input: {
      name: inst.name,
      suite: inst.suite,
      casePath: inst.casePath,
      configuration,
      compilerOptions,
      defaultOptions: { newLine: "crlf", skipDefaultLibCheck: true },
      captureSuggestions: (configuration["capturesuggestions"] ?? "").toLowerCase() === "true",
      useCaseSensitiveFileNames: ucsfn,
      currentDirectory: t.currentDirectory,
      configFile:
        t.tsConfigFiles.length > 0
          ? { name: t.tsConfigFiles[0].unitName, content: t.tsConfigFiles[0].content }
          : undefined,
      roots: t.toBeCompiled.map(f => ({ name: f.unitName, content: f.content })),
      otherFiles: t.otherFiles.map(f => ({ name: f.unitName, content: f.content })),
      rootNames: fsx.programFileNames,
      links: [...t.symlinks].map(([path, target]) => ({ path, target })),
      includeLibDirectory: fsx.includeLibDir,
      materialise(): MaterialiseResult {
        const below = options.materialiseBelow;
        if (below === undefined)
          return { ok: false, status: "no-directory", reason: "the run has no directory for instances" };
        mkdirSync(below, { recursive: true });
        platform ??= probePlatform(below + "/.platform");
        const m = materialise(
          fsx,
          t.currentDirectory,
          testLibFiles(options.layout.libRoot),
          `${below}/${id}`,
          platform,
        );
        if (!m.ok) return m;
        return { ok: true, value: { ...m.value, rootNames: m.value.roots } };
      },
    },
  };
}

export interface RoundTrip {
  equal: boolean;
  pretty: boolean;
  codes: number[];
}

// read(bytes) written again, against the bytes. The rules are the ones of the tool that wrote the file.
export function roundTrip(bytes: Uint8Array, rules: Rules = tsgoRules): RoundTrip {
  const model = rules.model;
  const parsed = readErrorBaseline(rules, model.fromBytes(bytes));
  const written = getErrorBaseline(rules, parsed.files, parsed.diagnostics, parsed.pretty);
  return {
    equal: written.failedChecks.length === 0 && Buffer.from(model.toBytes(written.text)).equals(Buffer.from(bytes)),
    pretty: parsed.pretty,
    codes: parsed.diagnostics.map(d => d.code),
  };
}

// k of n at even distances: the fixed rule of every sample.
export function evenSample<T>(all: readonly T[], most: number): T[] {
  if (all.length <= most) return [...all];
  const out: T[] = [];
  for (let k = 0; k < most; k++) out.push(all[Math.floor((k * all.length) / most)]);
  return out;
}

export { existsSync };
