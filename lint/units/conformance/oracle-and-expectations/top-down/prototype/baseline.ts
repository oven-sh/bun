// Prototype of runner/baseline.ts: the list reader and the root selection of internal/testutil/baseline/baseline.go, and the oracle of an instance.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { trimSpace } from "../../../enumerator/prototype/stringutil";

export type Suite = "compiler" | "conformance";
export type Kind = "E" | "C";
export type DiffRoot = "submodule" | "submoduleAccepted" | "submoduleTriaged";
export type Tag = "accepted" | "triaged" | "post-emit-order";
export type OracleSource = "typescript-go" | "expects-no-errors" | "typescript" | "none";

// baseline.go:28
export const noContent = "<no content>";

// baseline.go:108 readFileNameSet, on the text of the file decoded as UTF-8
export function readFileNameSet(content: string): Set<string> {
  const set = new Set<string>();
  for (let line of content.split("\n")) {
    line = trimSpace(line);
    if (line === "" || line.charCodeAt(0) === 0x23) continue;
    set.add(line);
  }
  return set;
}

// tsbaseline/util.go:13 tsExtension with tsbaseline/error_baseline.go:36
export function errorBaselineName(configuredName: string): string {
  return configuredName.replace(/\.tsx?$/, ".errors.txt");
}

// baseline.go:62-63
export function diffKey(suite: string, fileName: string): string {
  return suite + "/" + fileName + ".diff";
}

export class ListedTwice extends Error {}

// baseline.go:64-79; the two option fields of the same name have no caller that sets them
export function diffRoot(accepted: ReadonlySet<string>, triaged: ReadonlySet<string>, key: string): DiffRoot {
  const isSubmoduleAccepted = accepted.has(key);
  const isSubmoduleTriaged = triaged.has(key);
  if (isSubmoduleAccepted && isSubmoduleTriaged) {
    throw new ListedTwice(`diff file ${key} is in both submoduleAccepted and submoduleTriaged; it should only be in one`);
  }
  if (isSubmoduleAccepted) return "submoduleAccepted";
  if (isSubmoduleTriaged) return "submoduleTriaged";
  return "submodule";
}

export interface CorpusPaths {
  // one directory per suite with error baselines of typescript-go: all of them, or the ones whose bytes are not TypeScript's
  tsgoBaselines: string;
  // flat directory with the error baselines of TypeScript; undefined when tsgoBaselines holds all of typescript-go's
  tsBaselines: string | undefined;
  // list of "<suite>/<name>.errors.txt" that typescript-go ran without an error while TypeScript has a baseline; undefined with tsBaselines
  expectsNoErrors: string | undefined;
  accepted: string;
  triaged: string;
  // list of "<suite>/<name>.errors.txt" whose baseline depends on the emit that precedes the diagnostics
  postEmitOrder: string | undefined;
}

export interface Corpus {
  paths: CorpusPaths;
  tsgo: ReadonlyMap<Suite, ReadonlySet<string>>;
  ts: ReadonlySet<string> | undefined;
  expectsNoErrors: ReadonlySet<string>;
  accepted: ReadonlySet<string>;
  triaged: ReadonlySet<string>;
  postEmitOrder: ReadonlySet<string>;
}

const suites: readonly Suite[] = ["compiler", "conformance"];

function names(dir: string): Set<string> {
  return new Set(existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".errors.txt")) : []);
}

// Directory listings, not existence tests: a file system that ignores case must not answer for a name of another case.
export function loadCorpus(paths: CorpusPaths): Corpus {
  if ((paths.tsBaselines === undefined) !== (paths.expectsNoErrors === undefined)) {
    throw new Error("TypeScript's baselines and the list of instances without errors go together");
  }
  const list = (p: string | undefined) => (p === undefined ? new Set<string>() : readFileNameSet(readFileSync(p, "utf8")));
  return {
    paths,
    tsgo: new Map(suites.map(s => [s, names(paths.tsgoBaselines + "/" + s)])),
    ts: paths.tsBaselines === undefined ? undefined : names(paths.tsBaselines),
    expectsNoErrors: list(paths.expectsNoErrors),
    accepted: list(paths.accepted),
    triaged: list(paths.triaged),
    postEmitOrder: list(paths.postEmitOrder),
  };
}

export interface Oracle {
  kind: Kind;
  source: OracleSource;
  // file that holds the expected bytes, undefined for kind C
  path: string | undefined;
}

// The expected result of a run instance: four steps, the first that applies.
export function oracleOf(corpus: Corpus, suite: Suite, configuredName: string): Oracle {
  const file = errorBaselineName(configuredName);
  if (corpus.tsgo.get(suite)?.has(file)) {
    return { kind: "E", source: "typescript-go", path: `${corpus.paths.tsgoBaselines}/${suite}/${file}` };
  }
  if (corpus.expectsNoErrors.has(`${suite}/${file}`)) return { kind: "C", source: "expects-no-errors", path: undefined };
  if (corpus.ts?.has(file)) return { kind: "E", source: "typescript", path: `${corpus.paths.tsBaselines}/${file}` };
  return { kind: "C", source: "none", path: undefined };
}

// What the words of the specification give: typescript-go's file, else TypeScript's. Kept for the report of the difference only.
export function literalOracleOf(corpus: Corpus, suite: Suite, configuredName: string): Oracle {
  const file = errorBaselineName(configuredName);
  if (corpus.tsgo.get(suite)?.has(file)) {
    return { kind: "E", source: "typescript-go", path: `${corpus.paths.tsgoBaselines}/${suite}/${file}` };
  }
  if (corpus.ts?.has(file)) return { kind: "E", source: "typescript", path: `${corpus.paths.tsBaselines}/${file}` };
  return { kind: "C", source: "none", path: undefined };
}

export function readOracle(oracle: Oracle): Uint8Array | undefined {
  return oracle.path === undefined ? undefined : readFileSync(oracle.path);
}

// Tags say why a baseline is what it is. They change neither pass nor fail.
export function tagsOf(corpus: Corpus, suite: Suite, configuredName: string): Tag[] {
  const tags: Tag[] = [];
  const root = diffRoot(corpus.accepted, corpus.triaged, diffKey(suite, errorBaselineName(configuredName)));
  if (root === "submoduleAccepted") tags.push("accepted");
  if (root === "submoduleTriaged") tags.push("triaged");
  if (corpus.postEmitOrder.has(`${suite}/${errorBaselineName(configuredName)}`)) tags.push("post-emit-order");
  return tags;
}

// The keys of the two lists that name an error baseline, for the checks of the corpus.
export function errorKeys(set: ReadonlySet<string>): string[] {
  return [...set].filter(k => k.endsWith(".errors.txt.diff"));
}
