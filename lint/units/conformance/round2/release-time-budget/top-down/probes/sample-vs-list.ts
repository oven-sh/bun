// usage: bun sample-vs-list.ts <runner directory> <H>: the cases whose instances are not their lines of H/fixtures/instances.tsv (name, run or skipped, reason), for the sample of one case in 40, for the named cases, and for every case.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const [runnerDir, home] = process.argv.slice(2);
const { enumerateCase, skippedTests } = await import(join(runnerDir, "compiler_runner"));
const { skippedEmitTests } = await import(join(runnerDir, "harnessutil_options"));
const casesDir = join(home, "corpus/cases");
const cases = new Map<string, string>();
const walk = (rel: string) => {
  for (const entry of readdirSync(`${casesDir}/${rel}`, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) cases.set(entry.name, `${rel}/${entry.name}`);
  }
};
walk("compiler");
walk("conformance");
const caseBaseName = (n: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(n);
  return m === null ? n : m[1] + m[3];
};
const linesOfCase = new Map<string, string[]>();
for (const line of readFileSync(join(home, "fixtures/instances.tsv"), "utf8").split("\n").slice(0, -1)) {
  const [name, kind, reason] = line.split("\t");
  const path = cases.get(caseBaseName(name)) ?? "";
  const l = kind === "skipped" ? `${name}\tskipped\t${reason}` : `${name}\trun`;
  const lines = linesOfCase.get(path);
  if (lines === undefined) linesOfCase.set(path, [l]);
  else lines.push(l);
}
const differs = (path: string) => {
  let got: string[];
  try {
    got = enumerateCase(casesDir, path).map((i: any) => (i.status === "run" ? `${i.name}\trun` : `${i.name}\tskipped\t${i.status === "skip" ? i.skipReason : "invalid: " + i.invalidReason}`));
  } catch (e) {
    got = [`threw ${(e as Error).message}`];
  }
  return got.sort().join("\n") !== (linesOfCase.get(path) ?? []).slice().sort().join("\n");
};
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const hashed = [...cases.values()].filter(p => sampled(p, 40));
const named = [
  "emitHelpersWithLocalCollisions.ts",
  "callChainWithSuper.ts",
  "esmModuleExports2.ts",
  "moduleResolutionWithSuffixes_one.ts",
  "pathMappingInheritedBaseUrl.ts",
  "tsconfigExtendsPackageJsonExportsWildcard.ts",
  "declarationEmitSymlinkPaths.ts",
  "bom-utf16be.ts",
  "bom-utf16le.ts",
  ...skippedEmitTests.keys(),
].map(name => cases.get(name)!);
const all = [...cases.values()].filter(p => !skippedTests.includes(p.slice(p.lastIndexOf("/") + 1)));
const count = (paths: string[]) => paths.filter(differs);
const a = count(hashed), b = count(named), c = count(all);
console.log(`one case in 40: ${a.length} of ${hashed.length} differ | named: ${b.length} of ${named.length} differ${b.length ? " (" + b.map(p => p.slice(p.lastIndexOf("/") + 1)).join(", ") + ")" : ""} | every case: ${c.length} of ${all.length} differ`);
