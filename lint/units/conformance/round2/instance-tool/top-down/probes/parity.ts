// usage: bun parity.ts <stdout of sweep.ts --lines> <report of sweep.ts without --lines, same check and selectors>
// Holds each line of --lines against the entry of its instance in the report of the sweep: the same outcome, the line number of the
// sweep's reason, the two lines of its diff, or its reason. Also: every line is one line without a control character.
import { readFileSync } from "node:fs";
const [linesPath, reportPath] = process.argv.slice(2);
const raw = readFileSync(linesPath, "utf8");
const lines = raw.split("\n");
if (lines.pop() !== "") throw new Error("the output does not end in a line feed");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const control = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
const form = /^([a-z]+) ([^ :]+)(?:: (.*))?$/s;
const counts = { lines: lines.length, run: 0, skipped: 0, sameOutcome: 0, twoSided: 0, oracleOnly: 0, baselineOnly: 0, reason: 0, pass: 0, bad: 0, control: 0, cut: 0 };
const bad = (why: string, line: string) => {
  counts.bad++;
  if (counts.bad <= 10) console.log(`BAD ${why}: ${line.slice(0, 200)}`);
};
// A side as the line has it: "...", a JSON string, "...".
const side = /^(\.\.\.)?("(?:[^"\\]|\\.)*")(\.\.\.)?/;
for (const line of lines) {
  if (control.test(line)) counts.control++;
  const m = form.exec(line);
  if (m === null) { bad("no form", line); continue; }
  const [, outcome, name, rest] = m;
  const entry = report.instances[name];
  if (entry === undefined) {
    if (outcome === "skip") counts.skipped++;
    else bad("not in the report", line);
    continue;
  }
  counts.run++;
  if (entry.outcome !== outcome) { bad(`the sweep says ${entry.outcome}`, line); continue; }
  counts.sameOutcome++;
  if (outcome === "pass") { if (rest !== undefined) bad("a pass with more", line); else counts.pass++; continue; }
  const first = entry.first;
  const at = /^line (\d+):(.*)$/s.exec(rest ?? "");
  if (first === undefined || (first.expected === first.actual)) {
    if (at !== null && first === undefined) bad("a line where the report has no first difference", line);
    else if ((rest ?? "") !== entry.reason.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, (c: string) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))) bad("another reason", line);
    else counts.reason++;
    continue;
  }
  if (at === null) { bad("no line where the report has a first difference", line); continue; }
  if (Number(at[1]) !== first.line) { bad(`the report says line ${first.line}`, line); continue; }
  const inReason = /differs from the oracle at byte \d+, line (\d+)$/.exec(entry.reason);
  if (inReason !== null && Number(inReason[1]) !== first.line) { bad("the reason names another line", line); continue; }
  let text = at[2];
  const shown: Record<string, { text: string; before: boolean; after: boolean }> = {};
  for (const mark of ["-", "+"]) {
    if (!text.startsWith(` ${mark} `)) continue;
    const s = side.exec(text.slice(3));
    if (s === null) { bad("a side that is no JSON string", line); break; }
    shown[mark] = { text: JSON.parse(s[2]), before: s[1] !== undefined, after: s[3] !== undefined };
    text = text.slice(3 + s[0].length);
  }
  if (text !== "") { bad("text after the sides", line); continue; }
  const check = (mark: string, whole: string | undefined) => {
    const s = shown[mark];
    if (whole === undefined) return s === undefined;
    if (s === undefined) return false;
    if (s.before || s.after) counts.cut++;
    return s.before || s.after ? whole.includes(s.text) : whole === s.text;
  };
  if (!check("-", first.expected) || !check("+", first.actual)) { bad("a side that is not the line of the report", line); continue; }
  if (first.expected !== undefined && first.actual !== undefined) counts.twoSided++;
  else if (first.expected !== undefined) counts.oracleOnly++;
  else counts.baselineOnly++;
}
const inReport = Object.keys(report.instances).length;
console.log(JSON.stringify(counts), `instances of the report: ${inReport}`);
process.exit(counts.bad === 0 && counts.control === 0 && counts.run === inReport ? 0 : 1);
