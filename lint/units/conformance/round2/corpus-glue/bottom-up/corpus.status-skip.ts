// The corpus below one root: the instances of the enumerator with their oracles, the files of an instance, and what the lists need to know of it.
import { readdirSync } from "node:fs";
import { type EnumeratedInstance, enumerateCase, enumerateInstances } from "./compiler_runner";
import type { InstanceFacts } from "./expectations";
import { type CompilerTest, type InstanceInput, type Platform, findObstacles, instanceInput } from "./materialise";
import { type Oracle, diffRootOf, loadOracleTable, oracleOf, readOracle } from "./oracle";
import { type CorpusPaths, type Suite, corpusPaths, suites } from "./paths";
import type { InputResult, Instance } from "./run";
import { type TestUnit, parseTestFilesAndSymlinks } from "./test_case_parser";
import { readFile } from "./vfs";

// An instance of the enumerator with what the baselines and the two lists of typescript-go say of it.
export interface CorpusInstance extends Instance {
  suite: Suite;
  // The path of the case below the cases of the corpus: "conformance/types/tuple/castingTuple.ts".
  casePath: string;
  // The settings of the instance: those of the case with the values of its variation; undefined for a case without a setting.
  config: EnumeratedInstance["config"];
  // The case is one of skippedEmitTests: the reference skips its "output" subtest and still compares its error baseline.
  emitOnly: boolean;
  // submoduleAccepted.txt names the diff of the error baseline against TypeScript's; submoduleTriaged.txt names it.
  accepted: boolean;
  triaged: boolean;
  // Set where the reference neither runs nor skips the instance but fails it: the text with which it does, when it cannot set the instance up or both lists name the diff of its error baseline. The status of such an instance is "skip", the one status of run.ts that is not run, and it has no skipReason.
  invalidReason?: string;
  // Class C without a file for an instance that does not run: nothing compares it.
  oracle: Oracle;
}

// What the lists need to know of an instance of the corpus, with the instance.
export interface CorpusFacts extends InstanceFacts {
  instance: CorpusInstance;
}

export interface Corpus {
  paths: CorpusPaths;
  // The instances of the case at a path below the cases: none for a case that the reference leaves out by name or for a path that no suite lists; a case that cannot be read is one instance that the reference fails.
  enumerateCase(casePath: string): CorpusInstance[];
  // The instances of both suites in the order in which the reference starts them.
  enumerateInstances(): CorpusInstance[];
  // The input option of a run: the files of an instance as the harness lays them out; with a root they are written below it.
  input(instance: Instance, root: string | undefined): InputResult;
  // The oracle option of a run: the bytes of the error baseline of an instance of class E.
  oracle(instance: Instance): Uint8Array;
  // What the lists need to know of an instance; platformLimited lays the instance out when it is first read.
  facts(instance: CorpusInstance): CorpusFacts;
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
export function listCases(casesDirectory: string): string[] {
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

// The disks of the platforms of the test run, whichever of them runs this; Windows without the right to link to a file.
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

// Reads the three lists and the names of the baselines, once; it throws when one of them cannot be read. A case is read when it is enumerated or laid out.
export function openCorpus(root: string): Corpus {
  const paths = corpusPaths(root);
  const table = loadOracleTable(paths);
  const none: Oracle = { class: "C", source: "none" };

  const bind = (enumerated: EnumeratedInstance): CorpusInstance => {
    const { name, suite } = enumerated;
    const diff = diffRootOf(table, suite, name);
    const common = {
      name,
      suite,
      casePath: enumerated.file,
      config: enumerated.config,
      emitOnly: enumerated.emitOnly,
      accepted: diff.accepted,
      triaged: diff.triaged,
    };
    if (enumerated.status === "skip") {
      return { ...common, status: "skip", skipReason: enumerated.skipReason ?? "", oracle: none };
    }
    // The reference fails an instance whose diff is in both lists, as it fails one that it cannot set up.
    const stops = enumerated.status === "invalid" ? (enumerated.invalidReason ?? "") : diff.fatal;
    if (stops !== undefined) return { ...common, status: "skip", invalidReason: stops, oracle: none };
    return { ...common, status: "run", oracle: oracleOf(table, suite, name) };
  };

  return {
    paths,
    enumerateCase: casePath => enumerateCase(paths.cases, casePath).map(bind),
    enumerateInstances: () => enumerateInstances(paths.cases).map(bind),
    input(instance, root) {
      const laid = layOut(paths, instance as CorpusInstance, root);
      return laid.ok ? { ok: true, input: laid.input } : laid;
    },
    oracle: instance => readOracle((instance as CorpusInstance).oracle),
    facts(instance) {
      const { name, casePath } = instance;
      const known = { name, directory: directoryOf(casePath), casePath, instance };
      // No list may hold an instance that does not run, whatever a platform makes of its files.
      const notRun = { ...known, kind: undefined, platformLimited: undefined };
      if (instance.invalidReason !== undefined) return { ...notRun, status: "invalid", reason: instance.invalidReason };
      if (instance.status !== "run") return { ...notRun, status: "skipped", reason: instance.skipReason ?? "" };
      let limited: { why: string | undefined } | undefined;
      return {
        ...known,
        status: "run",
        reason: "",
        kind: instance.oracle.class,
        // Only the rules of the lists read it: an instance that a list holds, held or may take is laid out for it, once.
        get platformLimited() {
          return (limited ??= { why: platformLimitedOf(paths, instance) }).why;
        },
      };
    },
  };
}
