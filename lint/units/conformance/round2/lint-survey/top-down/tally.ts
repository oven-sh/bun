// usage: bun tally.ts <directory of reports of sweep.ts | instances.tsv> [--markdown]
// instances.tsv: the table that bottom-up/merge.ts writes of the same reports (name, class of the oracle, case path,
// outcome, class of the run, code, reason); the counts of the reports themselves (selected, skipped, seconds, the
// codes of the oracles, what may enter a list) are not in it.
// The survey of E4 from the reports of the chunks of sweep.ts (report.instances[name] = {kind, casePath, outcome,
// reason}), by the rules of runner/check_bun_lint.ts (readRun, toCheckResult) and runner/run.ts (attempt, compare):
//   not laid out   outcome unsupported: the files cannot be written as the harness has them; no process started.
//   C silent       outcome pass, class C: exit code 0 and nothing on stderr (the guard).
//   E silent       outcome fail "no diagnostic where the oracle has a baseline": the same for class E.
//   diagnostic     outcome crash "stderr line n has the code <name>, which is no code of TypeScript": the command
//                  ended with 0 or 2 and every line of stderr is a diagnostic; <name> is the code of the first line
//                  that has a name for a code (syntax, a rule, unsupported-extension, cannot-read-file).
//   internal-error outcome crash "the command reports an error of its own".
//   E pass         outcome pass, class E.
//   E ts-coded     outcome fail with another reason, class E: diagnostics with numbers of TypeScript that are not
//                  the oracle's. C ts-coded: outcome fail, class C.
//   died           outcome crash with: "the command ended by the signal", "the command ended with the exit code",
//                  "the command wrote to stdout", "stderr line n is ..." (a line that is no diagnostic),
//                  "the command refused" (exit code 1: no operand of a sweep is refused, and 1 is the exit code of
//                  a report of AddressSanitizer without abort_on_error), "the exit code is 0 and stderr has n
//                  errors", "the exit code is 2 and stderr has no error", "the command did not start".
//   timeout        outcome timeout ("the check did not end within n ms").
//   else           anything that is none of these: printed line by line. It has to be empty.
// It starts no process. The sums are checked: every instance is in one class, and a name is in one report.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [directory, ...rest] = process.argv.slice(2);
const markdown = rest.includes("--markdown");
if (directory === undefined) {
  console.error("usage: bun tally.ts <directory of reports> [--markdown]");
  process.exit(2);
}

interface Reported {
  kind: "E" | "C";
  casePath: string;
  outcome: string;
  reason: string;
}

type Class =
  | "not laid out"
  | "C silent"
  | "E silent"
  | "C diagnostic"
  | "E diagnostic"
  | "internal-error"
  | "E pass"
  | "E ts-coded"
  | "C ts-coded"
  | "died"
  | "timeout"
  | "else";

function classOf(r: Reported): { class: Class; code: string } {
  const as = (c: Class, code = "") => ({ class: c, code });
  const { outcome, reason, kind } = r;
  if (outcome === "unsupported") return as("not laid out");
  if (outcome === "timeout") return as("timeout");
  if (outcome === "pass") return as(kind === "C" ? "C silent" : "E pass");
  if (outcome === "fail") {
    if (kind === "E" && reason === "no diagnostic where the oracle has a baseline") return as("E silent");
    return as(kind === "E" ? "E ts-coded" : "C ts-coded");
  }
  if (outcome === "crash") {
    const named = /^the check threw: Error: stderr line \d+ has the code (\S+), which is no code of TypeScript$/.exec(reason);
    if (named !== null) return as(kind === "C" ? "C diagnostic" : "E diagnostic", named[1]);
    if (reason.startsWith("the check threw: Error: the command reports an error of its own")) return as("internal-error");
    if (
      /^the check threw: Error: (the command ended by the signal|the command ended with the exit code|the command wrote to stdout|the command refused|the command did not start|the command did not end in time|the exit code is (0|2) and stderr has|stderr line \d+ is )/.test(
        reason,
      )
    ) {
      return as("died");
    }
  }
  return as("else");
}

const topOf = (casePath: string): string => {
  const parts = casePath.split("/");
  return parts[0] !== "conformance" || parts.length <= 2 ? parts[0] : `${parts[0]}/${parts[1]}`;
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
  "E pass",
] as const;
type Column = (typeof columns)[number];
type Row = Record<Column, number>;
const emptyRow = (): Row => Object.fromEntries(columns.map(c => [c, 0])) as Row;

const fromTable = statSync(directory).isFile();
const files = fromTable
  ? [directory]
  : readdirSync(directory)
      .filter(name => name.endsWith(".json"))
      .sort();
const seen = new Map<string, string>();
const rows = new Map<string, Row>();
const suiteRows = new Map<string, Row>();
const total = emptyRow();
const byCode = new Map<string, number>();
const byCodeTop = new Map<string, number>();
const others = new Map<string, string[]>();
const notLaid = new Map<string, number>();
const cDiagnostics: string[] = [];
const head: string[] = [];
let selected = 0;
let skipped = 0;
let invalid = 0;
let seconds = 0;
const checks = new Set<string>();
const directoriesE: [number, number] = [0, 0];
const directoriesC: [number, number] = [0, 0];
const oracleCodes = new Map<string, { instances: number; pass: number; diagnostics: number }>();
let refusedToEnter = 0;
const refusedBy = new Map<string, number>();
let mayEnter = 0;
// A table as a report: the instances alone.
function reportOfTable(path: string) {
  const instances: Record<string, Reported> = {};
  let E = 0;
  let C = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line === "") continue;
    const [name, kind, casePath, outcome, , , reason] = line.split("\t");
    instances[name] = { kind: kind as "E" | "C", casePath, outcome, reason: reason ?? "" };
    if (kind === "E") E++;
    else C++;
  }
  const run = E + C;
  const totals = { selected: run, run, skipped: 0, invalid: 0, E: [0, E], C: [0, C] };
  return { selectors: ["(table)"], totals, seconds: 0, check: "(table)", notListed: { E: [], C: [] }, refused: [], codes: {}, instances };
}
for (const file of files) {
  const report = fromTable ? reportOfTable(file) : JSON.parse(readFileSync(join(directory, file), "utf8"));
  head.push(
    `  ${file}: ${report.selectors.join(" ")}; selected ${report.totals.selected}, run ${report.totals.run} (E ${report.totals.E[1]}, C ${report.totals.C[1]}), skipped ${report.totals.skipped}, invalid ${report.totals.invalid}; ${report.seconds} s`,
  );
  selected += report.totals.selected;
  skipped += report.totals.skipped;
  invalid += report.totals.invalid;
  seconds += report.seconds;
  checks.add(report.check);
  directoriesE[0] += report.totals.E[0];
  directoriesE[1] += report.totals.E[1];
  directoriesC[0] += report.totals.C[0];
  directoriesC[1] += report.totals.C[1];
  mayEnter += report.notListed.E.length + report.notListed.C.length;
  for (const r of report.refused as { reason: string }[]) {
    refusedToEnter++;
    refusedBy.set(r.reason, (refusedBy.get(r.reason) ?? 0) + 1);
  }
  for (const [code, count] of Object.entries(report.codes as Record<string, { instances: number; pass: number; diagnostics: number }>)) {
    const sum = oracleCodes.get(code) ?? { instances: 0, pass: 0, diagnostics: 0 };
    sum.instances += count.instances;
    sum.pass += count.pass;
    sum.diagnostics += count.diagnostics;
    oracleCodes.set(code, sum);
  }
  for (const [name, r] of Object.entries(report.instances as Record<string, Reported>)) {
    if (seen.has(name)) throw new Error(`${name} is in ${seen.get(name)} and in ${file}`);
    seen.set(name, file);
    const c = classOf(r);
    const top = topOf(r.casePath);
    const suite = r.casePath.split("/")[0];
    const add = (column: Column) => {
      for (const row of [
        rows.get(top) ?? rows.set(top, emptyRow()).get(top)!,
        suiteRows.get(suite) ?? suiteRows.set(suite, emptyRow()).get(suite)!,
        total,
      ]) {
        row[column]++;
      }
    };
    add("run");
    switch (c.class) {
      case "not laid out":
        add("not laid out");
        notLaid.set(r.reason.replace(/:.*/s, ""), (notLaid.get(r.reason.replace(/:.*/s, "")) ?? 0) + 1);
        break;
      case "C silent":
      case "E silent":
      case "E pass":
        add("result");
        add(c.class);
        break;
      case "C diagnostic":
      case "E diagnostic":
        add("result");
        add(c.class);
        byCode.set(`${r.kind} ${c.code}`, (byCode.get(`${r.kind} ${c.code}`) ?? 0) + 1);
        byCodeTop.set(`${top}\t${r.kind} ${c.code}`, (byCodeTop.get(`${top}\t${r.kind} ${c.code}`) ?? 0) + 1);
        if (r.kind === "C") cDiagnostics.push(`${r.casePath}\t${name}\t${c.code}`);
        break;
      case "died":
        add("died");
        break;
      case "timeout":
        add("timeout");
        break;
      default:
        break;
    }
    if (["died", "timeout", "internal-error", "E ts-coded", "C ts-coded", "else"].includes(c.class)) {
      const list = others.get(c.class) ?? [];
      list.push(`${name}\t${r.kind}\t${r.casePath}\t${r.outcome}\t${r.reason}`);
      others.set(c.class, list);
    }
  }
}

const out: string[] = [];
out.push(`check: ${[...checks].join(" | ")}`);
out.push(`reports ${files.length}: instances selected ${selected}, run ${seen.size} (E ${directoriesE[1]}, C ${directoriesC[1]}), skipped ${skipped}, invalid ${invalid}; ${Math.round(seconds)} s in sweep.ts`);
out.push(...head);
out.push(`pass by sweep.ts: E ${directoriesE[0]} of ${directoriesE[1]}, C ${directoriesC[0]} of ${directoriesC[1]}`);
out.push(`instances that pass and may enter a list: ${mayEnter}; that pass and may not: ${refusedToEnter} (${[...refusedBy].map(([k, v]) => `${k} ${v}`).join(", ")})`);
out.push("");
const sorted = [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1));
if (markdown) {
  out.push(`| directory | ${columns.join(" | ")} |`);
  out.push(`|---|${columns.map(() => "---:").join("|")}|`);
  const line = (label: string, row: Row) => `| ${label} | ${columns.map(c => row[c]).join(" | ")} |`;
  for (const [top, row] of sorted) out.push(line(top, row));
  for (const [suite, row] of [...suiteRows].sort()) out.push(line(`**${suite}, all**`, row));
  out.push(line("**total**", total));
} else {
  const width = Math.max(...sorted.map(([k]) => k.length), 16);
  const line = (label: string, row: Row) =>
    [label.padEnd(width), ...columns.map(c => String(row[c]).padStart(Math.max(c.length, 5)))].join("  ");
  out.push(["directory".padEnd(width), ...columns.map(c => c.padStart(Math.max(c.length, 5)))].join("  "));
  for (const [top, row] of sorted) out.push(line(top, row));
  for (const [suite, row] of [...suiteRows].sort()) out.push(line(`${suite}, all`, row));
  out.push(line("total", total));
}
out.push("");
// Every instance is in one class.
const classed = total["not laid out"] + total.result + total.died + total.timeout;
const inOthers = ["internal-error", "E ts-coded", "C ts-coded", "else"].reduce((n, k) => n + (others.get(k)?.length ?? 0), 0);
out.push(`check of the sums: not laid out ${total["not laid out"]} + result ${total.result} + died ${total.died} + timeout ${total.timeout} + internal-error, ts-coded and else ${inOthers} = ${classed + inOthers} of ${total.run} run`);
out.push(`result ${total.result} = C silent ${total["C silent"]} + C diagnostic ${total["C diagnostic"]} + E silent ${total["E silent"]} + E diagnostic ${total["E diagnostic"]} + E pass ${total["E pass"]}`);
out.push("");
out.push(`not laid out, by the first obstacle: ${[...notLaid].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
out.push("");
out.push("instances with a diagnostic of Bun, by class and the code of the first line that has a name for a code:");
for (const [key, n] of [...byCode].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) out.push(`  ${String(n).padStart(6)}  ${key}`);
out.push("");
out.push("the same by top directory:");
for (const [key, n] of [...byCodeTop].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const [top, code] = key.split("\t");
  out.push(`  ${top.padEnd(30)} ${code.padEnd(26)} ${String(n).padStart(5)}`);
}
out.push("");
const passing = [...oracleCodes].filter(([, c]) => c.pass > 0);
out.push(`codes in the oracles of class E: ${oracleCodes.size}; codes with an instance that passes: ${passing.length}`);
const topCodes = [...oracleCodes].sort((a, b) => b[1].instances - a[1].instances || Number(a[0].slice(2)) - Number(b[0].slice(2)));
out.push(`  the 12 most frequent (instances whose oracle has the code, of them pass): ${topCodes.slice(0, 12).map(([code, c]) => `${code} ${c.instances}/${c.pass}`).join(", ")}`);
out.push("");
out.push(`class C with a diagnostic of Bun: ${cDiagnostics.length} instances`);
for (const line of cDiagnostics.sort()) out.push(`  ${line}`);
out.push("");
for (const key of ["died", "timeout", "internal-error", "E ts-coded", "C ts-coded", "else"]) {
  const list = others.get(key) ?? [];
  out.push(`${key}: ${list.length}`);
  for (const line of list) out.push(`  ${line}`);
}
console.log(out.join("\n"));
