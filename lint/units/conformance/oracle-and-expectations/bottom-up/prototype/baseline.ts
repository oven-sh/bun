// Prototype port of the list reader and of the selection in internal/testutil/baseline/baseline.go, plus the oracle of an instance.
import { existsSync, readFileSync } from "node:fs";

export type Suite = "compiler" | "conformance";
export type Kind = "E" | "C";
export type Tag = "accepted" | "triaged" | "post-emit-order";
export type OracleSource = "typescript-go" | "typescript-go-wrote-none" | "TypeScript" | "none";

// baseline.go:28
export const NoContent = "<no content>";

// Go's unicode.IsSpace: it has U+0085 and lacks U+FEFF, unlike String.prototype.trim.
function isSpace(ch: number): boolean {
  switch (ch) {
    case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: case 0x20: case 0x85: case 0xa0:
    case 0x1680: case 0x2028: case 0x2029: case 0x202f: case 0x205f: case 0x3000:
      return true;
  }
  return ch >= 0x2000 && ch <= 0x200a;
}
export function trimSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isSpace(s.charCodeAt(start))) start++;
  while (end > start && isSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

// baseline.go:108 readFileNameSet, on the text of the file
export function parseFileNameSet(content: string): Set<string> {
  const set = new Set<string>();
  for (let line of content.split("\n")) {
    line = trimSpace(line);
    if (line === "" || line.charCodeAt(0) === 0x23) continue;
    set.add(line);
  }
  return set;
}

// baseline.go:108; the reference panics when the file cannot be read
export function readFileNameSet(path: string): Set<string> {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`failed to read file ${path}: ${(e as Error).message}`);
  }
  return parseFileNameSet(content);
}

// error_baseline.go:36 with tsbaseline/util.go:13
export function errorBaselineName(configuredName: string): string {
  return configuredName.replace(/\.tsx?$/, ".errors.txt");
}

// baseline.go:62
export function diffKey(subfolder: string, fileName: string): string {
  return subfolder + "/" + fileName + ".diff";
}

export type OutRoot = "submodule" | "submoduleAccepted" | "submoduleTriaged";

export class BaselineFatal extends Error {}

// baseline.go:64-79
export function selectOutRoot(subfolder: string, fileName: string, accepted: ReadonlySet<string>, triaged: ReadonlySet<string>): OutRoot {
  const diffFileName = fileName + ".diff";
  const key = subfolder + "/" + diffFileName;
  const isSubmoduleAccepted = accepted.has(key);
  const isSubmoduleTriaged = triaged.has(key);
  if (isSubmoduleAccepted && isSubmoduleTriaged) {
    throw new BaselineFatal(`diff file ${subfolder}/${diffFileName} is in both submoduleAccepted and submoduleTriaged; it should only be in one`);
  }
  if (isSubmoduleAccepted) return "submoduleAccepted";
  if (isSubmoduleTriaged) return "submoduleTriaged";
  return "submodule";
}

// compiler_runner.go:393 DiffFixupOld, on bytes held as a latin1 string
export function diffFixupOld(old: string): string {
  let out = "";
  for (let line of old.split("\n")) {
    if (line.startsWith("==== ./")) line = "==== " + line.slice("==== ./".length);
    out += line + "\n";
  }
  return out.slice(0, -1);
}

export interface OracleLayout {
  // directory with TypeScript's <stem>.errors.txt files, flat
  tsBaselines: string;
  // directory with one directory per suite that holds typescript-go's <stem>.errors.txt files
  tsgoBaselines: string;
  // true for a clone of typescript-go, false for the corpus, which holds only the files that differ from TypeScript's
  tsgoComplete: boolean;
  // list of <suite>/<stem>.errors.txt that typescript-go did not write although TypeScript has the file; needed when tsgoComplete is false
  expectsNoErrors: string | undefined;
  accepted: string;
  triaged: string;
}

export interface OracleSources {
  layout: OracleLayout;
  accepted: Set<string>;
  triaged: Set<string>;
  expectsNoErrors: Set<string>;
  postEmitOrder: ReadonlySet<string>;
}

// instances whose error baseline in typescript-go differs when the diagnostics are taken before the emit (measured on 89d5d5b)
export const postEmitOrder: ReadonlySet<string> = new Set([
  "compiler/incorrectRecursiveMappedTypeConstraint.errors.txt",
  "compiler/typeParameterWithInvalidConstraintType.errors.txt",
  "conformance/recursiveMappedTypes.errors.txt",
]);

export function loadOracleSources(layout: OracleLayout): OracleSources {
  if (!layout.tsgoComplete && layout.expectsNoErrors === undefined) throw new Error("the corpus layout needs the list of baselines that typescript-go did not write");
  return {
    layout,
    accepted: readFileNameSet(layout.accepted),
    triaged: readFileNameSet(layout.triaged),
    expectsNoErrors: layout.expectsNoErrors === undefined ? new Set() : readFileNameSet(layout.expectsNoErrors),
    postEmitOrder,
  };
}

export interface Oracle {
  kind: Kind;
  source: OracleSource;
  // path of the file that holds the expected bytes, undefined for kind C
  path: string | undefined;
  // what the literal rule "typescript-go's file, else TypeScript's" selects
  literalKind: Kind;
  tags: Tag[];
  outRoot: OutRoot;
}

export function selectOracle(src: OracleSources, suite: Suite, configuredName: string): Oracle {
  const fileName = errorBaselineName(configuredName);
  const key = suite + "/" + fileName;
  const go = src.layout.tsgoBaselines + "/" + suite + "/" + fileName;
  const ts = src.layout.tsBaselines + "/" + fileName;
  const outRoot = selectOutRoot(suite, fileName, src.accepted, src.triaged);
  const tags: Tag[] = [];
  if (outRoot === "submoduleAccepted") tags.push("accepted");
  if (outRoot === "submoduleTriaged") tags.push("triaged");
  if (src.postEmitOrder.has(key)) tags.push("post-emit-order");
  const hasGo = existsSync(go);
  const hasTs = existsSync(ts);
  const literalKind: Kind = hasGo || hasTs ? "E" : "C";
  const base = { tags, outRoot, literalKind };
  if (hasGo) return { ...base, kind: "E", source: "typescript-go", path: go };
  if (src.layout.tsgoComplete) return { ...base, kind: "C", source: hasTs ? "typescript-go-wrote-none" : "none", path: undefined };
  if (src.expectsNoErrors.has(key)) return { ...base, kind: "C", source: "typescript-go-wrote-none", path: undefined };
  if (hasTs) return { ...base, kind: "E", source: "TypeScript", path: ts };
  return { ...base, kind: "C", source: "none", path: undefined };
}
