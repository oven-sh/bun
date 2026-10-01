// usage: <bun> listtests.ts <tree>: the CPU time of the main thread for what the tests of the list compute, step by step.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
const tree = process.argv[2];
const H = `${tree}/test/cli/lint/conformance`;
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
let t = cpu();
const step = (label: string) => { const n = cpu(); console.log(`${String(Math.round(n - t)).padStart(6)} ms  ${label}`); t = cpu(); };
const { compareStrings } = await import(`${H}/runner/gostrings.ts`);
const { diffRootOf, loadOracleTable, oracleOf } = await import(`${H}/runner/oracle.ts`);
const { corpusPaths } = await import(`${H}/runner/paths.ts`);
step("imports");
const corpusRoot = `${H}/corpus`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const cases = new Map<string, string>();
const walk = (rel: string) => {
  for (const entry of readdirSync(`${corpusRoot}/cases/${rel}`, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) cases.set(entry.name, `${rel}/${entry.name}`);
  }
};
walk("compiler");
walk("conformance");
step(`cases(): the walk of ${cases.size} names`);
const reference = JSON.parse(readFileSync(`${H}/reference_counts.json`, "utf8"));
const listText = readFileSync(`${H}/fixtures/instances.tsv`, "utf8");
const listLines = listText.split("\n").slice(0, -1);
step("the list read and split");
const caseBaseName = (instanceName: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(instanceName);
  return m === null ? instanceName : m[1] + m[3];
};
const nameOfLine = (line: string) => line.slice(0, line.indexOf("\t"));
const linesOfCase = new Map<string, string[]>();
for (const line of listLines) {
  const path = cases.get(caseBaseName(nameOfLine(line))) ?? "";
  const lines = linesOfCase.get(path);
  if (lines === undefined) linesOfCase.set(path, [line]);
  else lines.push(line);
}
step("linesOfCase()");
const digest = sha256(listText);
const unique = new Set(listLines.map(nameOfLine)).size === listLines.length;
const kinds: any = { compiler: { E: 0, C: 0, skipped: 0 }, conformance: { E: 0, C: 0, skipped: 0 } };
const reasons: Record<string, number> = {};
for (const [path, lines] of linesOfCase) {
  const suite = path.startsWith("compiler/") ? "compiler" : "conformance";
  for (const line of lines) {
    const [, kind, reason] = line.split("\t");
    kinds[suite][kind]++;
    if (kind !== "skipped") continue;
    const key = reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1");
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
}
step(`the list test as it is: digest ${digest === reference.instances.sha256}, unique ${unique}, E ${kinds.compiler.E + kinds.conformance.E}`);
const goName = (name: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(name);
  return m === null ? name : `${m[1]}${m[3]}_${m[2]}`;
};
const rows = listLines.map(line => line.split("\t"));
const subtests = rows
  .map(([name, kind]) => `${kind === "skipped" ? "SKIP" : "PASS"}\t${goName(name)}`)
  .sort((a, b) => compareStrings(a.slice(5), b.slice(5)))
  .map(l => l + "\n")
  .join("");
const skips = rows
  .filter(([, kind]) => kind === "skipped")
  .map(([name, , reason]) => `${goName(name)}\t${reason}`)
  .sort(compareStrings)
  .map(l => l + "\n")
  .join("");
const ok = sha256(subtests) === reference.suiteRun.sha256 && sha256(skips) === reference.suiteRun.skipReasonsSha256;
step(`new: the digests of the recorded run from the list: ${ok}`);
const table = loadOracleTable(corpusPaths(corpusRoot));
step("new: loadOracleTable");
const suites: any = { compiler: { instances: 0, run: 0, skipped: 0, E: 0, C: 0 }, conformance: { instances: 0, run: 0, skipped: 0, E: 0, C: 0 } };
const counts = { accepted: 0, triaged: 0, typescriptGo: 0, typescript: 0 };
let other = 0;
const names = new Set<string>();
for (const [path, lines] of linesOfCase) {
  const suite = path.startsWith("compiler/") ? "compiler" : "conformance";
  for (const line of lines) {
    const [name, kind] = line.split("\t");
    names.add(caseBaseName(name));
    suites[suite].instances++;
    if (kind === "skipped") { suites[suite].skipped++; continue; }
    suites[suite].run++;
    const oracle = oracleOf(table, suite, name);
    suites[suite][oracle.class]++;
    if (oracle.class !== kind) other++;
    const diff = diffRootOf(table, suite, name);
    if (diff.accepted) counts.accepted++;
    if (diff.triaged) counts.triaged++;
    if (oracle.source === "typescript-go") counts.typescriptGo++;
    if (oracle.source === "typescript") counts.typescript++;
  }
}
const same = JSON.stringify({ cases: names.size, ...suites, ...counts }) === JSON.stringify({ cases: reference.cases.files - reference.cases.droppedByName, compiler: reference.instances.compiler, conformance: reference.instances.conformance, accepted: reference.instances.accepted, triaged: reference.instances.triaged, typescriptGo: reference.oracle["typescript-go"], typescript: reference.oracle.typescript });
step(`new: the oracle of every line and the counts: other class ${other}, counts the reference's ${same}`);
