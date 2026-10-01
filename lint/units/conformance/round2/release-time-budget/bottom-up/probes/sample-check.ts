// usage: bun sample-check.ts <tree>: the lines of the sampled cases (one in 40, and with the named cases) against the list, as the tests of the sample compare them.
import { readdirSync, readFileSync } from "node:fs";
const tree = process.argv[2];
const H = `${tree}/test/cli/lint/conformance`;
const runner = await import(`${H}/runner/index.ts`);
const corpus = runner.openCorpus(`${H}/corpus`);
const cases = new Map<string, string>();
const walk = (rel: string) => {
  for (const e of readdirSync(`${H}/corpus/cases/${rel}`, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${rel}/${e.name}`);
    else if (/\.tsx?$/.test(e.name)) cases.set(e.name, `${rel}/${e.name}`);
  }
};
walk("compiler");
walk("conformance");
const caseBaseName = (n: string) => { const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(n); return m === null ? n : m[1] + m[3]; };
const linesOfCase = new Map<string, string[]>();
for (const line of readFileSync(`${H}/fixtures/instances.tsv`, "utf8").split("\n").slice(0, -1)) {
  const path = cases.get(caseBaseName(line.slice(0, line.indexOf("\t")))) ?? "";
  (linesOfCase.get(path) ?? linesOfCase.set(path, []).get(path)!).push(line);
}
const lineOf = (i: any) => (i.status === "run" ? `${i.name}\t${i.oracle.class}` : `${i.name}\tskipped\t${i.skipReason}`);
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const named = ["anonymousDefaultExportsUmd.ts", "esmModuleExports2.ts", "moduleResolutionWithSuffixes_one.ts", "declarationEmitSymlinkPaths.ts", "tsconfigExtendsPackageJsonExportsWildcard.ts"];
const check = (label: string, sample: string[]) => {
  const differ: string[] = [];
  for (const path of sample) {
    const got = corpus.enumerateCase(path).map(lineOf).sort().join("\n");
    const want = (linesOfCase.get(path) ?? []).slice().sort().join("\n");
    if (got !== want) differ.push(path);
  }
  console.log(`${label}: ${sample.length} cases, ${differ.length} differ from the list${differ.length > 0 ? ": " + differ.join(" ") : ""}`);
};
const s40 = [...cases.values()].filter(p => sampled(p, 40)).sort();
check("one case in 40", s40);
check("one case in 40 and the named cases", [...new Set([...s40, ...named.map(n => cases.get(n)!)])].sort());
