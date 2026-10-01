// usage: <bun> list-tests.ts <H>: what the tests of the list do, with the processor time of each part; H/runner needs sortStrings.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const home = process.argv[2];
const { sortStrings } = await import(join(home, "runner/gostrings"));
const { diffRootOf, loadOracleTable, oracleStepOf } = await import(join(home, "runner/oracle"));
const { corpusPaths } = await import(join(home, "runner/paths"));
const corpusRoot = join(home, "corpus");
let c0 = process.cpuUsage();
let t0 = performance.now();
const part = (name: string, value: unknown) => {
  const c = process.cpuUsage(c0);
  console.log(`${name.padEnd(40)} wall ${(performance.now() - t0).toFixed(0).padStart(6)} ms, user+sys ${((c.user + c.system) / 1000).toFixed(0).padStart(6)} ms  ${JSON.stringify(value)}`);
  c0 = process.cpuUsage();
  t0 = performance.now();
};
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const reference = JSON.parse(readFileSync(join(home, "reference_counts.json"), "utf8"));
const cases = new Map<string, string>();
const walk = (rel: string) => {
  for (const entry of readdirSync(`${corpusRoot}/cases/${rel}`, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) cases.set(entry.name, `${rel}/${entry.name}`);
  }
};
walk("compiler");
walk("conformance");
part("cases(): the walk of the directories", cases.size);
const listText = readFileSync(join(home, "fixtures/instances.tsv"), "utf8");
const listLines = listText.split("\n").slice(0, -1);
const caseBaseName = (instanceName: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(instanceName);
  return m === null ? instanceName : m[1] + m[3];
};
const goName = (name: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(name);
  return m === null ? name : `${m[1]}${m[3]}_${m[2]}`;
};
const nameOfLine = (line: string) => line.slice(0, line.indexOf("\t"));
const linesOfCase = new Map<string, string[]>();
for (const line of listLines) {
  const path = cases.get(caseBaseName(nameOfLine(line))) ?? "";
  const lines = linesOfCase.get(path);
  if (lines === undefined) linesOfCase.set(path, [line]);
  else lines.push(line);
}
part("listLines() and linesOfCase()", linesOfCase.size);
{
  const same = sha256(listText) === reference.instances.sha256 && new Set(listLines.map(nameOfLine)).size === listLines.length;
  const kinds: any = { compiler: { E: 0, C: 0, skipped: 0 }, conformance: { E: 0, C: 0, skipped: 0 } };
  for (const [path, lines] of linesOfCase) {
    const suite = path.startsWith("compiler/") ? "compiler" : "conformance";
    for (const line of lines) kinds[suite][line.split("\t")[1]]++;
  }
  part("the list test as it is, with the suites", { same, kinds });
}
{
  const status = new Map<string, string>();
  const reasons: string[] = [];
  for (const line of listLines) {
    const [name, kind, reason] = line.split("\t");
    status.set(goName(name), kind === "skipped" ? "SKIP" : "PASS");
    if (kind === "skipped") reasons.push(`${goName(name)}\t${reason}`);
  }
  const lines = (all: string[]) => all.map(l => l + "\n").join("");
  const got = {
    subtests: status.size,
    sha256: sha256(lines(sortStrings([...status.keys()]).map((name: string) => `${status.get(name)}\t${name}`))),
    skipReasonsSha256: sha256(lines(sortStrings(reasons))),
  };
  const want = reference.suiteRun;
  part("the digests of the reference's run", { same: got.subtests === want.subtests && got.sha256 === want.sha256 && got.skipReasonsSha256 === want.skipReasonsSha256 });
}
{
  const table = loadOracleTable(corpusPaths(corpusRoot));
  part("loadOracleTable", table.typescriptBaselines.names.size);
  const counts: any = { "typescript-go": 0, "expects-no-errors": 0, typescript: 0, none: 0, accepted: 0, triaged: 0 };
  const sources = ["typescript-go", "expects-no-errors", "typescript", "none"] as const;
  const differ: string[] = [];
  for (const [path, lines] of linesOfCase) {
    const suite = path.slice(0, path.indexOf("/"));
    for (const line of lines) {
      const [name, kind] = line.split("\t");
      if (kind === "skipped") continue;
      const step = oracleStepOf(table, suite, name);
      counts[sources[step - 1]]++;
      if ((step === 1 || step === 3) !== (kind === "E")) differ.push(line);
      const diff = diffRootOf(table, suite, name);
      if (diff.fatal !== undefined) differ.push(`${name}: ${diff.fatal}`);
      if (diff.accepted) counts.accepted++;
      if (diff.triaged) counts.triaged++;
    }
  }
  const want = { ...reference.oracle, accepted: reference.instances.accepted, triaged: reference.instances.triaged };
  part("the oracle of every line that runs", { differ: differ.length, counts, same: JSON.stringify(counts) === JSON.stringify(want) });
}
