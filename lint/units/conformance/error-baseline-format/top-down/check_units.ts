// The baseline of each instance against the units of its case: order of the input files, source lines,
// and the round trip with the units as input files.
// usage: bun check_units.ts <go|ts> [name filter]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enumerateInstances } from "../../enumerator/prototype/compiler_runner";
import { makeUnitsFromTest } from "../../enumerator/prototype/test_case_parser";
import { getNormalizedAbsolutePath } from "../../enumerator/prototype/tspath";
import { readFile } from "../../enumerator/prototype/vfs";
import { WriterPanic, tscRules, tsgoRules } from "./diagnosticwriter";
import { type TestFile, getErrorBaseline, removeTestPathPrefixes } from "./error_baseline";
import { ReadError, readErrorBaseline } from "./reader";

const tests = "/workspace/ref/typescript-go/_submodules/TypeScript/tests";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const which = process.argv[2] ?? "go";
const filter = process.argv[3];
const rules = which === "ts" ? tscRules : tsgoRules;
const model = rules.model;

const e = enumerateInstances({ casesRoot: tests + "/cases", includeSkippedTests: true });
const counts: Record<string, number> = {};
const examples: Record<string, string[]> = {};
const bump = (k: string, name: string, detail = "") => {
  counts[k] = (counts[k] ?? 0) + 1;
  (examples[k] ??= []).length < 10 && examples[k].push(detail === "" ? name : `${name}: ${detail}`);
};
const seen = new Set<string>();
const newLineKinds: Record<string, number> = {};
for (const inst of e.instances) {
  const stem = inst.name.replace(/\.tsx?$/, "");
  if (filter !== undefined && !stem.includes(filter)) continue;
  const path = which === "ts" ? `${tests}/baselines/reference/${stem}.errors.txt` : `${GO}/${inst.suite}/${stem}.errors.txt`;
  if (!existsSync(path)) continue;
  if (which === "go" && inst.status !== "run") {
    bump("baseline of an instance that is not run", stem, inst.status + " " + inst.reason);
  }
  seen.add(stem);
  bump("baselines with an instance", stem);
  const read = readFile(`${tests}/cases/${inst.casePath}`);
  if (!read.ok) {
    bump("case not read", stem);
    continue;
  }
  if (read.lossy) bump("case with invalid UTF-8", stem);
  const made = makeUnitsFromTest(read.contents, `${tests}/cases/${inst.casePath}`);
  if (!made.ok) {
    bump("units not made", stem, made.reason);
    continue;
  }
  const c = made.value;
  const name = (n: string) => (which === "ts" ? n : getNormalizedAbsolutePath(n, c.currentDirectory));
  const file = (u: { name: string; content: string }): TestFile => ({
    unitName: model.fromString(name(u.name)),
    content: model.fromString(u.content),
  });
  const units = c.testUnitData;
  const config = inst.config;
  let toBeCompiled: TestFile[] = [];
  let otherFiles: TestFile[] = [];
  const tsConfigFiles: TestFile[] = [];
  let withConfig = false;
  if (c.tsConfigFileUnitData !== undefined) {
    withConfig = true;
    tsConfigFiles.push(file(c.tsConfigFileUnitData));
    toBeCompiled = units.map(file);
  } else {
    const lastUnit = units[units.length - 1];
    const noImplicitReferences =
      which === "ts"
        ? [...(config ?? new Map<string, string>())].some(([k, v]) => k === "noimplicitreferences" && v !== "")
        : (config?.get("noimplicitreferences") ?? "") !== "";
    if (noImplicitReferences || lastUnit.content.includes("require(") || /reference[\t\n\f\r ]path/.test(lastUnit.content)) {
      toBeCompiled.push(file(lastUnit));
      for (const u of units.slice(0, -1)) otherFiles.push(file(u));
    } else {
      toBeCompiled = units.map(file);
    }
  }
  const inputFiles = [...tsConfigFiles, ...toBeCompiled, ...otherFiles];
  for (const f of inputFiles) {
    const k = f.content.includes("\r\n") ? (/(^|[^\r])\n/.test(f.content) ? "mixed" : "CR LF") : f.content.includes("\n") ? "LF" : "one line";
    newLineKinds[k] = (newLineKinds[k] ?? 0) + 1;
  }

  const bytes = readFileSync(path);
  const text = model.fromBytes(bytes);
  // Order of the sections against the order of the input files.
  const heads = [...text.matchAll(/(?<=\r\n)==== (.*) \((\d+) errors\) ====(?=\r\n)/g)].map(m => m[1]);
  const expected = inputFiles.map(f => removeTestPathPrefixes(rules, f.unitName));
  if (heads.length !== expected.length) {
    bump("number of sections differs from the number of input files", stem, `${heads.length} against ${expected.length}`);
    continue;
  }
  if (heads.join("\n") !== expected.join("\n")) {
    if ([...heads].sort().join("\n") !== [...expected].sort().join("\n")) {
      bump("names of sections differ from the names of input files", stem, `${heads.join(",")} against ${expected.join(",")}`);
      continue;
    }
    if (withConfig) {
      // The order with a configuration file needs the file names of the parsed configuration.
      bump("with configuration file: units that the configuration does not name are after the others", stem);
      const byName = new Map(inputFiles.map(f => [removeTestPathPrefixes(rules, f.unitName), f]));
      inputFiles.length = 0;
      for (const h of heads) inputFiles.push(byName.get(h)!);
    } else {
      bump("order of sections differs from the order of input files", stem, `${heads.join(",")} against ${expected.join(",")}`);
      continue;
    }
  }
  try {
    const parsed = readErrorBaseline(rules, text, { units: inputFiles });
    // The writer gets the input files of the case, not the files of the reader.
    const written = getErrorBaseline(rules, inputFiles, parsed.diagnostics, parsed.pretty);
    if (model.toBytes(written.text).equals(bytes)) bump("round trip with the units of the case", stem);
    else {
      const a = text.split("\r\n");
      const b = written.text.split("\r\n");
      let k = 0;
      while (k < a.length && k < b.length && a[k] === b[k]) k++;
      bump("bytes differ with the units of the case", stem, `line ${k + 1}: ${JSON.stringify(a[k])?.slice(0, 120)} against ${JSON.stringify(b[k])?.slice(0, 120)}`);
    }
    if (written.failedChecks.length > 0) bump("failed check of the writer", stem, written.failedChecks.join("; "));
  } catch (err) {
    if (err instanceof ReadError) bump("reader error with the units of the case", stem, err.message.slice(0, 200));
    else if (err instanceof WriterPanic) bump("writer panic with the units of the case", stem, err.message);
    else throw err;
  }
}
console.log(`== ${which} baselines, ${rules.name} rules`);
for (const k of Object.keys(counts).sort()) {
  console.log(`  ${counts[k]}  ${k}`);
  if (!k.startsWith("round trip") && !k.startsWith("baselines with")) for (const x of examples[k]) console.log(`        ${x}`);
}
console.log("  line breaks of the input files:", JSON.stringify(newLineKinds));
writeFileSync(join(import.meta.dir, `check_units-${which}.json`), JSON.stringify({ counts, examples, newLineKinds }, null, 1));
