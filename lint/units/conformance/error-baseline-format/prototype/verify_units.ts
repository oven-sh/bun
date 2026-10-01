// Reads every baseline with the units of its case and compares: section names, section order, text, round trip.
// usage: bun verify_units.ts [go|ts]
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extractCompilerSettings, makeUnitsFromTest } from "../../directive-grammar/prototype/test_case_parser";
import { readFile } from "../../directive-grammar/prototype/vfs";
import type { Diagnostic } from "./diagnosticwriter";
import { type Rules, type TestFile, getErrorBaseline } from "./error_baseline";
import { utf8ToByteString } from "./go_compat";
import { BaselineReadError, type ParsedDiagnostic, readErrorBaseline } from "./reader";
import { getPathComponents, getPathFromPathComponents, reducePathComponents } from "./tspath";

const SUB = "/workspace/ref/typescript-go/_submodules/TypeScript";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const which = process.argv[2] ?? "go";

function getNormalizedAbsolutePath(fileName: string, currentDirectory: string): string {
  return getPathFromPathComponents(reducePathComponents(getPathComponents(fileName, currentDirectory)));
}

const cases = new Map<string, string>();
function walk(dir: string, suite: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, suite);
    else if (/\.tsx?$/.test(e.name)) cases.set(suite + "/" + e.name.replace(/\.tsx?$/, ""), p);
  }
}
walk(join(SUB, "tests/cases/compiler"), "compiler");
walk(join(SUB, "tests/cases/conformance"), "conformance");

const baselines: { suite: string | undefined; path: string }[] = [];
if (which === "go") {
  for (const suite of ["compiler", "conformance"]) {
    for (const f of readdirSync(join(GO, suite)).sort()) {
      if (f.endsWith(".errors.txt")) baselines.push({ suite, path: join(GO, suite, f) });
    }
  }
} else {
  const dir = join(SUB, "tests/baselines/reference");
  for (const f of readdirSync(dir).sort()) {
    if (f.endsWith(".errors.txt")) baselines.push({ suite: undefined, path: join(dir, f) });
  }
}

const byOrder = (a: Diagnostic, b: Diagnostic): number => (a as ParsedDiagnostic).order - (b as ParsedDiagnostic).order;
const count: Record<string, number> = {};
const examples: Record<string, string[]> = {};
const bump = (k: string, f: string, detail = "") => {
  count[k] = (count[k] ?? 0) + 1;
  if ((examples[k] ??= []).length < 12) examples[k].push(basename(f) + (detail ? " — " + detail : ""));
};

for (const b of baselines) {
  const name = basename(b.path).replace(/\.errors\.txt$/, "").replace(/\([^()]*\)$/, "");
  const config = /\(([^()]*)\)$/.exec(basename(b.path).replace(/\.errors\.txt$/, ""))?.[1];
  const casePath = b.suite !== undefined ? cases.get(b.suite + "/" + name) : (cases.get("compiler/" + name) ?? cases.get("conformance/" + name));
  if (casePath === undefined) {
    bump("no case file", b.path);
    continue;
  }
  const r = readFile(casePath);
  if (!r.ok) {
    bump("case not readable: " + r.reason, b.path);
    continue;
  }
  const made = makeUnitsFromTest(r.value, casePath);
  if (!made.ok) {
    bump("units: " + made.reason, b.path);
    continue;
  }
  const settings = extractCompilerSettings(r.value);
  // The current directory can be one of the varied options: take the value that the name of the baseline gives.
  let currentDirectorySetting = settings.get("currentdirectory") ?? "";
  if (config !== undefined) {
    for (const pair of config.split(",")) {
      const eq = pair.indexOf("=");
      if (eq > 0 && pair.slice(0, eq) === "currentdirectory") currentDirectorySetting = pair.slice(eq + 1);
    }
  }
  const currentDirectory = getNormalizedAbsolutePath(currentDirectorySetting, "/.src");
  const toFile = (u: { name: string; content: string }): TestFile => ({
    unitName: which === "go" ? getNormalizedAbsolutePath(u.name, currentDirectory) : u.name,
    content: utf8ToByteString(u.content),
  });
  const units = made.value.testUnitData.map(toFile);
  const configUnit = made.value.tsConfigFileUnitData === undefined ? undefined : toFile(made.value.tsConfigFileUnitData);
  const all = configUnit === undefined ? units : [configUnit, ...units];

  const text = readFileSync(b.path).toString("latin1");
  let done = false;
  for (const rules of ["tsgo", "tsc"] as Rules[]) {
    let withUnits;
    let without;
    try {
      without = readErrorBaseline(text, { rules });
    } catch (e) {
      if (e instanceof BaselineReadError) continue;
      throw e;
    }
    try {
      withUnits = readErrorBaseline(text, { rules, units: all });
    } catch (e) {
      if (!(e instanceof BaselineReadError)) throw e;
      bump("read with units fails", b.path, e.message.slice(0, 160));
      done = true;
      break;
    }
    const written = getErrorBaseline(withUnits.files, withUnits.diagnostics, byOrder, withUnits.pretty, rules);
    if (written.text !== text) {
      if (rules === "tsgo") continue;
      bump("round trip with units fails", b.path);
      done = true;
      break;
    }
    done = true;
    bump("ok with units (" + rules + ")", b.path);
    // Section names against unit names.
    const strip = (n: string) => n.replace(/\/\.ts\/|\/\.lib\/|\/\.src\/|bundled:\/\/\/libs\//g, "");
    const sectionNames = withUnits.files.map(f => strip(f.unitName));
    const unitNames = all.map(u => strip(u.unitName));
    if (sectionNames.length !== unitNames.length) bump("number of sections is not the number of units", b.path, `${sectionNames.length} sections, ${unitNames.length} units`);
    else {
      const sortedA = [...sectionNames].sort().join("\n");
      const sortedB = [...unitNames].sort().join("\n");
      if (sortedA !== sortedB) bump("section names are not the unit names", b.path, JSON.stringify(sectionNames) + " against " + JSON.stringify(unitNames));
      else {
        // Order: config first; then either all units in order, or the last unit first.
        const inOrder = sectionNames.join("\n") === unitNames.join("\n");
        const unitOnly = configUnit === undefined ? unitNames : unitNames.slice(1);
        const lastFirst = [...(configUnit === undefined ? [] : [unitNames[0]]), unitOnly[unitOnly.length - 1], ...unitOnly.slice(0, -1)].join("\n") === sectionNames.join("\n");
        const lastUnit = made.value.testUnitData[made.value.testUnitData.length - 1];
        const wantsLastFirst = (settings.get("noimplicitreferences") ?? "") !== "" || lastUnit.content.includes("require(") || /reference[\t\n\f\r ]path/.test(lastUnit.content);
        if (configUnit !== undefined) bump(inOrder ? "order with config: units in order" : lastFirst ? "order with config: last first" : "order with config: other", b.path, inOrder || lastFirst ? "" : JSON.stringify(sectionNames));
        else if (unitOnly.length === 1) bump("order: one unit", b.path);
        else if (wantsLastFirst && lastFirst) bump("order: last unit first, as the rule says", b.path);
        else if (!wantsLastFirst && inOrder) bump("order: units in order, as the rule says", b.path);
        else bump("order: NOT what the rule says", b.path, JSON.stringify(sectionNames));
      }
    }
    // Text and spans with and without the units.
    let sameText = without.files.length === withUnits.files.length;
    for (let i = 0; sameText && i < without.files.length; i++) sameText = without.files[i].content === withUnits.files[i].content;
    if (!sameText) bump("text differs without the units", b.path);
    let sameSpans = without.diagnostics.length === withUnits.diagnostics.length;
    for (let i = 0; sameSpans && i < without.diagnostics.length; i++) {
      sameSpans = without.diagnostics[i].pos === withUnits.diagnostics[i].pos && without.diagnostics[i].end === withUnits.diagnostics[i].end;
    }
    if (!sameSpans) bump("spans differ without the units", b.path);
    if (all.some(u => u.content.includes("\r"))) bump("a unit holds CR", b.path);
    break;
  }
  if (!done) bump("no rules read the baseline", b.path);
}
console.log(`== ${which}: ${baselines.length} baselines`);
for (const k of Object.keys(count).sort()) {
  console.log(`  ${k}: ${count[k]}`);
  if (!k.startsWith("ok") && !k.startsWith("order: units in order") && !k.startsWith("order: one") && !k.startsWith("order: last unit first")) for (const e of examples[k]) console.log(`      ${e}`);
}
