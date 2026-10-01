// The enumerator, the oracle and the files of an instance bound to one corpus root: what conformance.test.ts and sweep.ts ask of a corpus.
import { readdirSync } from "node:fs";
import { type EnumeratedInstance, enumerateCase, enumerateInstances } from "./compiler_runner";
import type { InstanceFacts } from "./expectations";
import { type CompilerTest, type InstanceInput, type Platform, findObstacles, instanceInput } from "./materialise";
import { type Oracle, type OracleTable, diffRootOf, loadOracleTable, oracleOf, readOracle } from "./oracle";
import { type CorpusPaths, type Suite, corpusPaths, suites } from "./paths";
import type { InputResult, Instance } from "./run";
import { type TestUnit, parseTestFilesAndSymlinks } from "./test_case_parser";
import { readFile } from "./vfs";

// An instance of the enumerator with its oracle and with what typescript-go's two lists say of its error baseline.
export interface CorpusInstance extends Instance {
  suite: Suite;
  // The path of the case below the cases of the corpus: "conformance/types/tuple/castingTuple.ts".
  casePath: string;
  // The settings of the instance: those of the case with the values of its variation; undefined for a case without a setting.
  config: EnumeratedInstance["config"];
  // The case is one of skippedEmitTests: the reference compares its error baseline and not its output.
  emitOnly: boolean;
  // submoduleAccepted.txt names the diff of the error baseline of the instance against TypeScript's.
  accepted: boolean;
  // submoduleTriaged.txt names it.
  triaged: boolean;
  // For an instance that does not run: class C without a file, which nothing reads.
  oracle: Oracle;
  // The text with which the reference fails the instance where it does not skip it. The status is "skip" then, and skipReason is "invalid: " and this text.
  invalidReason?: string;
}

// What the lists of expectations.json need to know of an instance, with the instance.
export interface CorpusFacts extends InstanceFacts {
  instance: CorpusInstance;
}

export interface Corpus {
  paths: CorpusPaths;
  // Reads now what is otherwise read when it is first asked for: the paths of the cases, the names of the baselines and the three lists. It throws CorpusError.
  load(): void;
  // The paths of the cases below the cases of the corpus, with forward slashes, in the order of their code units.
  cases(): readonly string[];
  // The path of the case of an instance, or of a case by its file name; undefined where the corpus has no such case.
  caseOf(name: string): string | undefined;
  // The instances of the case at a path below the cases, as the reference makes them; none for a case that it leaves out by name.
  enumerateCase(casePath: string): CorpusInstance[];
  // The instances of both suites in the order of the reference: the compiler suite, then the conformance suite.
  enumerateInstances(): CorpusInstance[];
  // The input option of a run: the files of an instance as the harness lays them out; with a root they are written below it.
  input(instance: Instance, root: string | undefined): InputResult;
  // The oracle option of a run: the bytes of the error baseline of an instance of class E.
  oracle(instance: Instance): Uint8Array;
  // platformLimited of the facts is worked out when it is first read: it lays the instance out.
  facts(instance: CorpusInstance): CorpusFacts;
}

// The corpus cannot be read, or two of its cases have one name.
export class CorpusError extends Error {}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// "a(target=es2015).ts" is an instance of the case "a.ts".
export function caseBaseName(instanceName: string): string {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(instanceName);
  return m === null ? instanceName : m[1] + m[3];
}

// The suite of a case and the directories below it: "conformance/types/tuple" of "conformance/types/tuple/castingTuple.ts".
export function directoryOf(casePath: string): string {
  return casePath.slice(0, casePath.lastIndexOf("/"));
}

// The paths of the cases below the directory of the cases, with forward slashes, in the order of their code units.
function listCases(casesDirectory: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(`${casesDirectory}/${rel}`, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (/\.tsx?$/.test(entry.name)) out.push(`${rel}/${entry.name}`);
    }
  };
  for (const suite of suites) walk(suite);
  return out.sort();
}

// An instance that does not run has no oracle.
const noOracle: Oracle = { class: "C", source: "none" };

// An instance of the enumerator with what the baselines and the two lists of typescript-go say of it.
function instanceOf(enumerated: EnumeratedInstance, table: OracleTable): CorpusInstance {
  const { name, suite, file, config, emitOnly } = enumerated;
  const diff = diffRootOf(table, suite, name);
  const known = { name, suite, casePath: file, config, emitOnly, accepted: diff.accepted, triaged: diff.triaged };
  if (enumerated.status === "skip") {
    return { ...known, status: "skip", skipReason: enumerated.skipReason ?? "", oracle: noOracle };
  }
  // The reference fails an instance whose diff is in both lists, as it fails one that it cannot set up.
  const stops = enumerated.status === "invalid" ? (enumerated.invalidReason ?? "") : diff.fatal;
  if (stops === undefined) return { ...known, status: "run", oracle: oracleOf(table, suite, name) };
  return { ...known, status: "skip", skipReason: `invalid: ${stops}`, invalidReason: stops, oracle: noOracle };
}

// What a check gets of an instance with the test that its files are written from, or why the instance cannot be laid out.
type Layout = { ok: true; input: InstanceInput; test: CompilerTest } | { ok: false; reason: string };

// The files of an instance as the harness lays them out; with a root they are written below it.
function layOut(paths: CorpusPaths, instance: CorpusInstance, root: string | undefined): Layout {
  const filename = `${paths.cases}/${instance.casePath}`;
  const read = readFile(filename);
  if (!read.ok) return { ok: false, reason: `the case cannot be read: ${filename}` };
  const units = parseTestFilesAndSymlinks<TestUnit>(read.contents, filename, (unitName, content) => ({
    value: { name: unitName, content },
    error: undefined,
  }));
  if (!units.ok) return { ok: false, reason: units.reason };
  const made = instanceInput(units, instance.config, root, { libDirectory: paths.lib });
  if (made.ok) return { ok: true, input: made.input, test: made.test };
  return {
    ok: false,
    reason: made.status === "invalid" ? `the reference fails the instance: ${made.reason}` : made.reason,
  };
}

// The disks of the platforms of the test run, whichever of them reads the corpus; Windows without the right to link to a file.
const testPlatforms: readonly Platform[] = [
  { os: "linux", caseSensitive: true, preservesNames: true, fileLinks: true },
  { os: "darwin", caseSensitive: false, preservesNames: false, fileLinks: true },
  { os: "win32", caseSensitive: false, preservesNames: true, fileLinks: false },
];

// Why a platform of the test run cannot hold the files of an instance that runs: the first obstacle of the first such platform. Undefined: every platform holds them.
function platformLimitedOf(paths: CorpusPaths, instance: CorpusInstance): string | undefined {
  let laid: Layout;
  try {
    laid = layOut(paths, instance, undefined);
  } catch (error) {
    laid = { ok: false, reason: `the files cannot be laid out: ${messageOf(error)}` };
  }
  if (!laid.ok) return `every platform: ${laid.reason}`;
  for (const platform of testPlatforms) {
    const [first] = findObstacles(laid.test, platform);
    if (first !== undefined) return `${platform.os}: ${first.reason}${first.detail === "" ? "" : `: ${first.detail}`}`;
  }
  return undefined;
}

// What the lists need to know of an instance.
function factsOf(paths: CorpusPaths, instance: CorpusInstance): CorpusFacts {
  const { name, casePath } = instance;
  const of = { name, directory: directoryOf(casePath), casePath, instance };
  // No list may hold an instance that does not run, whatever a platform makes of its files.
  if (instance.status !== "run") {
    const status = instance.invalidReason === undefined ? "skipped" : "invalid";
    const reason = instance.invalidReason ?? instance.skipReason ?? "";
    return { ...of, status, reason, kind: undefined, platformLimited: undefined };
  }
  let limited: { why: string | undefined } | undefined;
  return {
    ...of,
    status: "run",
    reason: "",
    kind: instance.oracle.class,
    // Only the rules of the lists read it: an instance that a list holds, held or may take is laid out for it, once.
    get platformLimited() {
      return (limited ??= { why: platformLimitedOf(paths, instance) }).why;
    },
  };
}

// Nothing is read before it is asked for: what cannot be read then, and two cases of one name, throw CorpusError.
export function openCorpus(root: string): Corpus {
  const paths = corpusPaths(root);
  const read = <T>(what: () => T): T => {
    try {
      return what();
    } catch (error) {
      throw new CorpusError(`the corpus at ${root} cannot be read: ${messageOf(error)}`);
    }
  };
  let listed: string[] | undefined;
  const cases = () => (listed ??= read(() => listCases(paths.cases)));
  let loaded: OracleTable | undefined;
  const table = () => (loaded ??= read(() => loadOracleTable(paths)));
  let named: Map<string, string> | undefined;
  // The name of an instance says which case it is of: the reference, too, stops where two cases have one name.
  const byBaseName = () => {
    if (named !== undefined) return named;
    const out = new Map<string, string>();
    for (const path of cases()) {
      const base = path.slice(path.lastIndexOf("/") + 1);
      const other = out.get(base);
      if (other !== undefined) throw new CorpusError(`the corpus has two cases of one name: ${other} and ${path}`);
      out.set(base, path);
    }
    return (named = out);
  };
  return {
    paths,
    load() {
      cases();
      table();
      byBaseName();
    },
    cases,
    caseOf: name => byBaseName().get(name) ?? byBaseName().get(caseBaseName(name)),
    enumerateCase: casePath => enumerateCase(paths.cases, casePath).map(e => instanceOf(e, table())),
    enumerateInstances: () => enumerateInstances(paths.cases).map(e => instanceOf(e, table())),
    input(instance, below) {
      const laid = layOut(paths, instance as CorpusInstance, below);
      return laid.ok ? { ok: true, input: laid.input } : laid;
    },
    oracle: instance => readOracle((instance as CorpusInstance).oracle),
    facts: instance => factsOf(paths, instance),
  };
}
