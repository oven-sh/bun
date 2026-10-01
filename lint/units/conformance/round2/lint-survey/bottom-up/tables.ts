// usage: bun tables.ts <directory observed/> <raw.jsonl of raw.ts> [clone with the corpus]
// With the clone, class-c-diagnostics.txt shows below each line the line of the unit that it points into.
// Reads instances.tsv (merge.ts), roots.tsv (roots.ts) and the raw runs of the instances whose outcome was crash or
// timeout, and writes into observed/:
//   codes.txt                 the diagnostics of Bun by class, category and code: lines and instances; the most frequent texts
//   class-c-diagnostics.txt   class C instances where Bun printed a diagnostic (TypeScript has none): case, roots, lines
//   javascript.txt            the instances with a JavaScript root: what the rules and the parser said
//   died.txt                  every run that died or hung, with the root file that reproduces it alone
//   raw-diagnostic-lines.tsv  every diagnostic line of every raw run: instance, class, file, line, column, category, code, text
// It starts no process.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [observedArg, rawPath, scratch] = process.argv.slice(2);
if (observedArg === undefined || rawPath === undefined) {
  console.error("usage: bun tables.ts <directory observed/> <raw.jsonl>");
  process.exit(2);
}
const observed = resolve(observedArg);

interface Instance {
  name: string;
  kind: "E" | "C";
  casePath: string;
  outcome: string;
  class: string;
  code: string;
  reason: string;
}
const instances: Instance[] = readFileSync(join(observed, "instances.tsv"), "utf8")
  .split("\n")
  .filter(line => line !== "")
  .map(line => {
    const [name, kind, casePath, outcome, cls, code, reason] = line.split("\t");
    return { name, kind: kind as "E" | "C", casePath, outcome, class: cls, code, reason: reason ?? "" };
  });
const instanceOf = new Map(instances.map(i => [i.name, i]));

const rootsOf = new Map<string, string[]>();
for (const line of readFileSync(join(observed, "roots.tsv"), "utf8").split("\n")) {
  if (line === "") continue;
  const [name, , , , roots] = line.split("\t");
  rootsOf.set(name, roots.startsWith("REFUSED") ? [] : roots.split(" "));
}

interface Alone {
  file: string;
  died: string;
  exitCode: number | null;
  signal: string | number | null;
  ms: number;
  stdout?: string;
  stderr: string;
}
interface Raw {
  name: string;
  kind: "E" | "C";
  casePath: string;
  was: string;
  roots?: string[];
  currentDirectory?: string;
  ms?: number;
  exitCode?: number | null;
  signal?: string | number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  stderrBytes?: number;
  died?: string;
  alone?: Alone[];
  kept?: string;
  notLaid?: string;
  threw?: string;
}
const raws: Raw[] = readFileSync(resolve(rawPath), "utf8")
  .split("\n")
  .filter(line => line !== "")
  .map(line => JSON.parse(line));
raws.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// tsc_plain_format.ts: the two heads of a diagnostic line.
const globalHead = /^(error|warning|suggestion|message) ((?:TS-?\d+)|(?:[A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/s;
const locatedHead = /^(\S.*?)\((\d+),(\d+)\): (error|warning|suggestion|message) ((?:TS-?\d+)|(?:[A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/s;
interface Printed {
  file: string;
  line: number;
  column: number;
  category: string;
  code: string;
  text: string;
}
function diagnosticsOf(stderr: string): Printed[] {
  const out: Printed[] = [];
  for (const line of stderr.split("\n")) {
    let m = globalHead.exec(line);
    if (m !== null) {
      out.push({ file: "", line: 0, column: 0, category: m[1], code: m[2], text: m[3] });
      continue;
    }
    m = locatedHead.exec(line);
    if (m !== null) out.push({ file: m[1], line: Number(m[2]), column: Number(m[3]), category: m[4], code: m[5], text: m[6] });
  }
  return out;
}

const isJavaScript = (file: string) => /\.(js|jsx|mjs|cjs)$/.test(file);
const pad = (n: number, width = 6) => String(n).padStart(width);
const mostFirst = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
const bump = (counts: Map<string, number>, key: string, by = 1) => counts.set(key, (counts.get(key) ?? 0) + by);

// codes.txt and raw-diagnostic-lines.tsv
const lineCounts = new Map<string, number>();
const instanceCounts = new Map<string, number>();
const texts = new Map<string, number>();
const textInstances = new Map<string, Set<string>>();
const categoriesOf = new Map<string, Set<string>>();
const allLines: string[] = [];
const printedOf = new Map<string, Printed[]>();
let normal = 0;
for (const raw of raws) {
  if (raw.stderr === undefined || (raw.died ?? "") !== "") continue;
  normal++;
  const printed = diagnosticsOf(raw.stderr);
  printedOf.set(raw.name, printed);
  const seen = new Set<string>();
  const categories = new Set<string>();
  for (const d of printed) {
    bump(lineCounts, `${raw.kind} ${d.category} ${d.code}`);
    seen.add(`${raw.kind} ${d.code}`);
    categories.add(d.category);
    const shape = `${d.category} ${d.code}: ${d.text.replace(/"[^"]*"/g, '"…"').replace(/'[^']*'/g, "'…'").replace(/\d+/g, "N")}`;
    bump(texts, shape);
    let set = textInstances.get(shape);
    if (set === undefined) textInstances.set(shape, (set = new Set()));
    set.add(raw.name);
    allLines.push([raw.name, raw.kind, d.file, d.line, d.column, d.category, d.code, d.text.replaceAll("\t", " ")].join("\t"));
  }
  for (const key of seen) bump(instanceCounts, key);
  categoriesOf.set(raw.name, categories);
}
const codes: string[] = [];
codes.push(`raw runs ${raws.length}; ended by themselves with a list of diagnostics ${normal}`);
codes.push("");
codes.push("diagnostic lines by class, category and code:");
for (const [key, n] of mostFirst(lineCounts)) codes.push(`  ${pad(n)}  ${key}`);
codes.push("");
codes.push("instances by class and code (an instance counts once for each code that it has):");
for (const [key, n] of mostFirst(instanceCounts)) codes.push(`  ${pad(n)}  ${key}`);
codes.push("");
const warningsOnly = [...categoriesOf].filter(([, c]) => c.size === 1 && c.has("warning")).map(([name]) => name);
codes.push(`instances whose lines are all warnings (exit code 0): ${warningsOnly.length}`);
for (const name of warningsOnly) {
  const raw = raws.find(r => r.name === name)!;
  codes.push(`  ${raw.kind} ${name} (${raw.casePath})`);
  for (const line of raw.stderr!.trimEnd().split("\n")) codes.push(`      ${line}`);
}
codes.push("");
codes.push(`texts with quoted names and numbers left out: ${texts.size}; lines, instances`);
for (const [shape, n] of mostFirst(texts)) codes.push(`  ${pad(n)} ${pad(textInstances.get(shape)!.size)}  ${shape}`);
writeFileSync(join(observed, "codes.txt"), codes.join("\n") + "\n");
writeFileSync(join(observed, "raw-diagnostic-lines.tsv"), allLines.join("\n") + "\n");

// The line of a unit of an instance that a printed path and a line name; undefined without the clone or the unit.
let sourceLineOf = (_name: string, _casePath: string, _printed: string, _line: number): string | undefined => undefined;
if (scratch !== undefined) {
  const home = resolve(scratch, "test/cli/lint/conformance");
  const { corpusPaths } = await import(join(home, "runner/paths.ts"));
  const { enumerateCase } = await import(join(home, "runner/compiler_runner.ts"));
  const { instanceInput } = await import(join(home, "runner/materialise.ts"));
  const { parseTestFilesAndSymlinks } = await import(join(home, "runner/test_case_parser.ts"));
  const { readFile } = await import(join(home, "runner/vfs.ts"));
  const { getNormalizedAbsolutePath } = await import(join(home, "runner/tspath.ts"));
  const paths = corpusPaths(join(home, "corpus"));
  const unitsOf = new Map<string, { currentDirectory: string; units: { unitName: string; content: string }[] } | undefined>();
  sourceLineOf = (name, casePath, printed, line) => {
    if (!unitsOf.has(name)) {
      let laid: { currentDirectory: string; units: { unitName: string; content: string }[] } | undefined;
      const enumerated = enumerateCase(paths.cases, casePath).find((i: { name: string }) => i.name === name);
      const filename = `${paths.cases}/${casePath}`;
      const read = readFile(filename);
      if (enumerated !== undefined && read.ok) {
        const units = parseTestFilesAndSymlinks(read.contents, filename, (unitName: string, content: string) => ({
          value: { name: unitName, content },
          error: undefined,
        }));
        const made = units.ok ? instanceInput(units, enumerated.config, undefined, { libDirectory: paths.lib }) : units;
        if (made.ok) {
          laid = { currentDirectory: getNormalizedAbsolutePath(made.input.currentDirectory, "/"), units: made.input.units };
        }
      }
      unitsOf.set(name, laid);
    }
    const laid = unitsOf.get(name);
    if (laid === undefined) return undefined;
    const virtual = getNormalizedAbsolutePath(printed, laid.currentDirectory);
    const unit = laid.units.find(u => getNormalizedAbsolutePath(u.unitName, laid.currentDirectory) === virtual);
    // The lines of ECMAScript, which the command counts by.
    return unit?.content.split(/\r\n|[\r\n\u2028\u2029]/)[line - 1];
  };
}

// class-c-diagnostics.txt: grouped by case and by what was printed.
const classC: string[] = [];
const groups = new Map<string, { casePath: string; names: string[]; roots: string[]; stderr: string; exitCode: number | null | undefined }>();
for (const raw of raws) {
  if (raw.kind !== "C" || raw.stderr === undefined || raw.stderr === "" || (raw.died ?? "") !== "") continue;
  const key = `${raw.casePath}\n${raw.stderr}`;
  let group = groups.get(key);
  if (group === undefined) {
    groups.set(key, (group = { casePath: raw.casePath, names: [], roots: raw.roots ?? [], stderr: raw.stderr, exitCode: raw.exitCode }));
  }
  group.names.push(raw.name);
}
const cInstances = [...groups.values()].reduce((n, g) => n + g.names.length, 0);
classC.push(`class C instances where Bun printed a diagnostic: ${cInstances}, of ${groups.size} cases`);
classC.push("TypeScript (typescript-go at the pinned commit) reports nothing for these. A line is as the command printed it: the path is relative to the current directory /.src, the line and the column are those of the unit, not of the case file.");
classC.push("");
const byCodeC = new Map<string, number>();
for (const group of groups.values()) {
  for (const code of new Set(diagnosticsOf(group.stderr).map(d => `${d.category} ${d.code}`))) bump(byCodeC, code, group.names.length);
}
for (const [key, n] of mostFirst(byCodeC)) classC.push(`  ${pad(n)}  ${key}`);
classC.push("");
for (const group of [...groups.values()].sort((a, b) => (a.casePath < b.casePath ? -1 : 1))) {
  classC.push(`${group.casePath}`);
  classC.push(`  instances: ${group.names.join(", ")}`);
  classC.push(`  root files: ${group.roots.join(" ")}; exit code ${group.exitCode}`);
  for (const line of group.stderr.trimEnd().split("\n")) {
    classC.push(`    ${line}`);
    const [d] = diagnosticsOf(line);
    const source = d === undefined || d.file === "" ? undefined : sourceLineOf(group.names[0], group.casePath, d.file, d.line);
    if (source !== undefined) {
      const from = Math.max(0, d.column - 1 - 70);
      classC.push(`        | ${JSON.stringify(source.slice(from, from + 160))}${from > 0 ? ` (from column ${from + 1})` : ""}`);
    }
  }
  classC.push("");
}
writeFileSync(join(observed, "class-c-diagnostics.txt"), classC.join("\n") + "\n");

// javascript.txt
const js: string[] = [];
const withJs = instances.filter(i => (rootsOf.get(i.name) ?? []).some(isJavaScript));
const jsByClass = new Map<string, number>();
for (const i of withJs) bump(jsByClass, `${i.kind} ${i.class}${i.code === "" ? "" : ` ${i.code}`}`);
js.push(`instances with a JavaScript root: ${withJs.length} (E ${withJs.filter(i => i.kind === "E").length}, C ${withJs.filter(i => i.kind === "C").length})`);
js.push("by class of the oracle, class of the run and first code:");
for (const [key, n] of mostFirst(jsByClass)) js.push(`  ${pad(n)}  ${key}`);
js.push("");
const ruleLines: string[] = [];
const ruleCounts = new Map<string, number>();
const ruleInstances = new Map<string, Set<string>>();
const notRules = new Set(["syntax", "cannot-read-file", "unsupported-extension", "internal-error", "internal-stand-in"]);
for (const raw of raws) {
  const printed = printedOf.get(raw.name);
  if (printed === undefined) continue;
  const ofRules = printed.filter(d => !notRules.has(d.code) && !/^TS-?\d+$/.test(d.code));
  if (ofRules.length === 0) continue;
  ruleLines.push(`${raw.kind} ${raw.name} (${raw.casePath}); root files ${(raw.roots ?? []).join(" ")}`);
  for (const d of ofRules) {
    ruleLines.push(`    ${d.file}(${d.line},${d.column}): ${d.category} ${d.code}: ${d.text}`);
    bump(ruleCounts, d.code);
    let set = ruleInstances.get(d.code);
    if (set === undefined) ruleInstances.set(d.code, (set = new Set()));
    set.add(raw.name);
  }
}
js.push("reports of rules: lines, instances");
for (const [code, n] of mostFirst(ruleCounts)) js.push(`  ${pad(n)} ${pad(ruleInstances.get(code)!.size)}  ${code}`);
js.push("");
js.push(...ruleLines);
js.push("");
const unsupported = raws.filter(raw => (printedOf.get(raw.name) ?? []).some(d => d.code === "unsupported-extension"));
js.push(`instances with the code unsupported-extension: ${unsupported.length}`);
for (const raw of unsupported) {
  js.push(`  ${raw.kind} ${raw.name} (${raw.casePath})`);
  for (const d of printedOf.get(raw.name)!.filter(d => d.code === "unsupported-extension")) js.push(`      ${d.category} ${d.code}: ${d.text}`);
}
writeFileSync(join(observed, "javascript.txt"), js.join("\n") + "\n");

// died.txt
const died: string[] = [];
const dead = raws.filter(raw => (raw.died ?? "") !== "" || raw.threw !== undefined || raw.notLaid !== undefined);
const was = instances.filter(i => i.class === "died" || i.class === "timeout" || !["silent", "diagnostic", "not-laid-out"].includes(i.class));
died.push(`instances that sweep.ts reports as died, timeout or anything else that is no result: ${was.length}`);
for (const i of was) died.push(`  ${i.kind} ${i.name} (${i.casePath}): ${i.outcome}: ${i.reason}`);
died.push("");
died.push(`raw runs that died, hung, threw or were not laid out: ${dead.length} of ${raws.length}`);
died.push("");
for (const raw of dead) {
  died.push(`${raw.kind} ${raw.name}`);
  died.push(`  case: ${raw.casePath}; sweep.ts said: ${instanceOf.get(raw.name)?.outcome}: ${instanceOf.get(raw.name)?.reason}`);
  if (raw.notLaid !== undefined) died.push(`  not laid out: ${raw.notLaid}`);
  if (raw.threw !== undefined) died.push(`  raw.ts threw: ${raw.threw}`);
  if (raw.died !== undefined && raw.died !== "") {
    died.push(`  died: ${raw.died}; exit code ${raw.exitCode}, signal ${raw.signal}, ${raw.ms} ms, stderr ${raw.stderrBytes} bytes`);
    died.push(`  root files: ${(raw.roots ?? []).join(" ")} in ${raw.currentDirectory}`);
    died.push("  stderr:");
    for (const line of (raw.stderr ?? "").split("\n").slice(0, 40)) died.push(`      ${line}`);
    if ((raw.stdout ?? "") !== "") {
      died.push("  stdout:");
      for (const line of raw.stdout!.split("\n").slice(0, 45)) died.push(`      ${line}`);
    }
    for (const alone of raw.alone ?? []) {
      died.push(`  alone ${alone.file}: ${alone.died === "" ? "does not reproduce" : alone.died}; exit code ${alone.exitCode}, signal ${alone.signal}, ${alone.ms} ms`);
      if (alone.died !== "") {
        for (const line of alone.stderr.split("\n").slice(0, 40)) died.push(`      ${line}`);
        for (const line of (alone.stdout ?? "").split("\n").slice(0, 45)) died.push(`      | ${line}`);
      }
    }
    if (raw.kept !== undefined) died.push(`  files kept at ${raw.kept}`);
  }
  died.push("");
}
writeFileSync(join(observed, "died.txt"), died.join("\n") + "\n");

// What the raw run says against what sweep.ts said.
let differ = 0;
for (const raw of raws) {
  const i = instanceOf.get(raw.name);
  if (i === undefined) continue;
  const first = (printedOf.get(raw.name) ?? []).find(d => !/^TS-?\d+$/.test(d.code))?.code ?? "";
  const same = i.class === "diagnostic" ? (raw.died ?? "") === "" && first === i.code : (raw.died ?? "") !== "";
  if (!same) {
    differ++;
    console.log(`differs from sweep.ts: ${raw.name}: sweep ${i.class} ${i.code}; raw died "${raw.died}" first code "${first}"`);
  }
}
console.log(codes.slice(0, 30).join("\n"));
console.log(`class C with a diagnostic: ${cInstances} instances of ${groups.size} cases`);
console.log(`died or hung in the raw runs: ${dead.length}; raw runs that differ from what sweep.ts said: ${differ}`);
