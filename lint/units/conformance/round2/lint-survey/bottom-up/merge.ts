// usage: bun merge.ts <directory of reports of sweep.ts> <directory observed/>
// Merges the reports of the chunks (report.instances[name] = {kind, casePath, outcome, reason}) and classifies every
// instance from what the default check of 3110ce85cf says. Writes instances.tsv (one line per run instance) and
// survey.txt (the counts by top directory and in total). It starts no process and reads nothing but the reports.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [reportsDirectory, observed] = process.argv.slice(2);
if (reportsDirectory === undefined || observed === undefined) {
  console.error("usage: bun merge.ts <directory of reports> <directory observed/>");
  process.exit(2);
}

interface Reported {
  kind: "E" | "C";
  casePath: string;
  outcome: string;
  reason: string;
}

// silent: the command ended with 0 and wrote nothing. diagnostic: it printed a line whose code is a name (Bun's parser,
// a rule, a word of the command). died: a signal, an exit code that is not 0 or 2, a text on stdout or a line of stderr
// that is no diagnostic. refused: exit code 1. not-laid-out: this disk cannot hold the files, no process started.
export type Class =
  | "silent"
  | "diagnostic"
  | "ts-coded"
  | "internal-error"
  | "died"
  | "timeout"
  | "refused"
  | "inconsistent"
  | "not-laid-out"
  | "unavailable"
  | "other";

export function classify(r: Reported): { class: Class; code: string } {
  const { outcome, reason } = r;
  const none = (c: Class) => ({ class: c, code: "" });
  if (outcome === "timeout") return none("timeout");
  if (outcome === "unsupported") return none("not-laid-out");
  if (outcome === "unavailable") return none("unavailable");
  if (outcome === "pass") return r.kind === "C" ? none("silent") : none("ts-coded");
  if (outcome === "fail") {
    if (reason === "no diagnostic where the oracle has a baseline") return none("silent");
    return none("ts-coded");
  }
  if (outcome === "crash") {
    const named = /stderr line \d+ has the code (\S+), which is no code of TypeScript/.exec(reason);
    if (named !== null) return { class: "diagnostic", code: named[1] };
    if (reason.includes("the command reports an error of its own")) return none("internal-error");
    if (reason.includes("the command did not end in time")) return none("timeout");
    if (
      reason.includes("the command ended by the signal") ||
      reason.includes("the command ended with the exit code") ||
      reason.includes("the command wrote to stdout") ||
      /stderr line \d+ is /.test(reason)
    ) {
      return none("died");
    }
    if (reason.includes("the command refused")) return none("refused");
    if (reason.includes("the exit code is")) return none("inconsistent");
  }
  return none("other");
}

const files = readdirSync(reportsDirectory)
  .filter(name => name.endsWith(".json"))
  .sort();
const instances = new Map<string, Reported & { chunk: string }>();
const chunks: string[] = [];
let selected = 0;
let skipped = 0;
let seconds = 0;
let check = "";
for (const file of files) {
  const report = JSON.parse(readFileSync(join(reportsDirectory, file), "utf8"));
  chunks.push(
    `${file}: selectors ${report.selectors.join(" ")}; selected ${report.totals.selected}, run ${report.totals.run}, skipped ${report.totals.skipped}, invalid ${report.totals.invalid}; ${report.seconds} s; ${report.check}`,
  );
  selected += report.totals.selected;
  skipped += report.totals.skipped;
  seconds += report.seconds;
  check = report.check;
  for (const [name, r] of Object.entries(report.instances as Record<string, Reported>)) {
    if (instances.has(name)) throw new Error(`${name} is in ${instances.get(name)!.chunk} and in ${file}`);
    instances.set(name, { kind: r.kind, casePath: r.casePath, outcome: r.outcome, reason: r.reason, chunk: file });
  }
}

const topOf = (casePath: string): string => {
  const parts = casePath.split("/");
  if (parts[0] !== "conformance" || parts.length <= 2) return parts[0];
  return `${parts[0]}/${parts[1]}`;
};

const columns = [
  "run",
  "not laid out",
  "result",
  "died",
  "timeout",
  "C silent",
  "C diagnostic",
  "E silent",
  "E diagnostic",
  "internal-error",
  "else",
] as const;
type Column = (typeof columns)[number];
type Row = Record<Column, number>;
const emptyRow = (): Row => Object.fromEntries(columns.map(c => [c, 0])) as Row;
const rows = new Map<string, Row>();
const total = emptyRow();
// The first code of the first diagnostic line, by class and code.
const codes = new Map<string, number>();
const elsewhere: string[] = [];
const lines: string[] = [];
const names = [...instances.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
for (const name of names) {
  const r = instances.get(name)!;
  const c = classify(r);
  lines.push([name, r.kind, r.casePath, r.outcome, c.class, c.code, r.reason.replaceAll("\t", " ")].join("\t"));
  const top = topOf(r.casePath);
  let row = rows.get(top);
  if (row === undefined) rows.set(top, (row = emptyRow()));
  const add = (column: Column) => {
    row![column]++;
    total[column]++;
  };
  add("run");
  switch (c.class) {
    case "silent":
      add("result");
      add(r.kind === "C" ? "C silent" : "E silent");
      break;
    case "diagnostic":
      add("result");
      add(r.kind === "C" ? "C diagnostic" : "E diagnostic");
      codes.set(`${r.kind} ${c.code}`, (codes.get(`${r.kind} ${c.code}`) ?? 0) + 1);
      break;
    case "internal-error":
      add("result");
      add("internal-error");
      break;
    case "not-laid-out":
      add("not laid out");
      break;
    case "died":
      add("died");
      break;
    case "timeout":
      add("timeout");
      break;
    default:
      add("else");
      elsewhere.push(`${name}\t${r.kind}\t${r.outcome}\t${r.reason}`);
  }
}

const out: string[] = [];
out.push(`check ${check}`);
out.push(`reports ${files.length}; instances selected ${selected}, run ${instances.size}, skipped ${skipped}; ${Math.round(seconds)} s in sweep.ts`);
for (const chunk of chunks) out.push(`  ${chunk}`);
out.push("");
out.push("columns: run = instances that the reference runs; not laid out = outcome unsupported, no process started;");
out.push("result = the command ended with 0 or 2 and every line of stderr is a diagnostic; died = a signal, another exit");
out.push("code, a text on stdout or a line of stderr that is no diagnostic; C silent = class C, stderr empty, exit 0 (the");
out.push("pass of the guard); C diagnostic = class C and Bun printed a diagnostic; E silent = class E and Bun printed");
out.push("nothing; E diagnostic = class E and Bun printed a diagnostic; else = anything that is none of these.");
out.push("");
const width = Math.max(...[...rows.keys()].map(k => k.length), 5);
out.push(["directory".padEnd(width), ...columns.map(c => c.padStart(Math.max(c.length, 6)))].join("  "));
const format = (label: string, row: Row) =>
  [label.padEnd(width), ...columns.map(c => String(row[c]).padStart(Math.max(c.length, 6)))].join("  ");
for (const [top, row] of [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(format(top, row));
out.push(format("total", total));
out.push("");
const suiteRow = (suite: string) => {
  const row = emptyRow();
  for (const [top, r] of rows) if (top === suite || top.startsWith(`${suite}/`)) for (const c of columns) row[c] += r[c];
  return row;
};
out.push(format("compiler", suiteRow("compiler")));
out.push(format("conformance", suiteRow("conformance")));
out.push("");
out.push("class and code of the first line of stderr that has a name for a code (the reason of sweep.ts names no other):");
for (const [key, n] of [...codes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
  out.push(`  ${String(n).padStart(6)}  ${key}`);
}
out.push("");
out.push(`class E that pass: ${names.filter(n => instances.get(n)!.kind === "E" && instances.get(n)!.outcome === "pass").length}`);
out.push(`else: ${elsewhere.length}`);
for (const line of elsewhere) out.push(`  ${line}`);

mkdirSync(observed, { recursive: true });
writeFileSync(join(observed, "instances.tsv"), lines.join("\n") + "\n");
writeFileSync(join(observed, "survey.txt"), out.join("\n") + "\n");
console.log(out.join("\n"));
