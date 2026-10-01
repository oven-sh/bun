// Prototype: the enumerator, the oracle and the files of an instance, bound to one corpus root.
import { type EnumeratedInstance, enumerateCase, enumerateInstances } from "./compiler_runner";
import { instanceInput } from "./materialise";
import { type Oracle, type OracleTable, diffRootOf, loadOracleTable, oracleOf, readOracle } from "./oracle";
import { type CorpusPaths, corpusPaths } from "./paths";
import type { InputResult, Instance } from "./run";
import { type TestUnit, parseTestFilesAndSymlinks } from "./test_case_parser";
import { readFile } from "./vfs";

export interface CorpusInstance extends Instance {
  suite: EnumeratedInstance["suite"];
  // The path of the case below the cases of the corpus: "conformance/types/tuple/castingTuple.ts".
  casePath: string;
  config: EnumeratedInstance["config"];
  emitOnly: boolean;
  accepted: boolean;
  triaged: boolean;
  oracle: Oracle;
  notes: string[];
}

export interface Corpus {
  paths: CorpusPaths;
  enumerateCase(casePath: string): CorpusInstance[];
  enumerateInstances(): CorpusInstance[];
  input(instance: Instance, root: string | undefined): InputResult;
  oracle(instance: Instance): Uint8Array;
}

export function openCorpus(root: string): Corpus {
  const paths = corpusPaths(root);
  let loaded: OracleTable | undefined;
  const table = () => (loaded ??= loadOracleTable(paths));
  const bind = (e: EnumeratedInstance): CorpusInstance => {
    const diff = diffRootOf(table(), e.suite, e.name);
    const common = {
      name: e.name,
      suite: e.suite,
      casePath: e.file,
      config: e.config,
      emitOnly: e.emitOnly,
      accepted: diff.accepted,
      triaged: diff.triaged,
      notes: e.notes,
    };
    const none: Oracle = { class: "C", source: "none" };
    if (e.status === "skip") return { ...common, status: "skip", skipReason: e.skipReason ?? "", oracle: none };
    const stops = e.status === "invalid" ? (e.invalidReason ?? "") : diff.fatal;
    if (stops !== undefined) return { ...common, status: "skip", skipReason: `invalid: ${stops}`, oracle: none };
    return { ...common, status: "run", oracle: oracleOf(table(), e.suite, e.name) };
  };
  return {
    paths,
    enumerateCase: casePath => enumerateCase(paths.cases, casePath).map(bind),
    enumerateInstances: () => enumerateInstances(paths.cases).map(bind),
    input(instance, below) {
      const i = instance as CorpusInstance;
      const filename = `${paths.cases}/${i.casePath}`;
      const read = readFile(filename);
      if (!read.ok) return { ok: false, reason: `the case cannot be read: ${filename}` };
      const units = parseTestFilesAndSymlinks<TestUnit>(read.contents, filename, (unitName, content) => ({
        value: { name: unitName, content },
        error: undefined,
      }));
      if (!units.ok) return { ok: false, reason: units.reason };
      const made = instanceInput(units, i.config, below, { libDirectory: paths.lib });
      if (made.ok) return { ok: true, input: made.input };
      return { ok: false, reason: made.reason };
    },
    oracle: instance => readOracle((instance as CorpusInstance).oracle),
  };
}
