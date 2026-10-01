// usage: bun parity.ts <lines of instances.ts> <report of sweep.ts>
// Each line of the tool against the instance of the report: the outcome, the number of the line, and the two lines against the first "- " and "+ " of the diff of the report.
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split("\n").slice(0, -1);
const report = JSON.parse(readFileSync(process.argv[3], "utf8"));
const count = new Map<string, number>();
const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
const display = (line: string) => {
  const text = line.replaceAll("\x1b", "\\x1b").replaceAll("\r", "\\r").replaceAll("\n", "\\n");
  return text.length > 500 ? text.slice(0, 500) + "..." : text;
};
const bad: string[] = [];
let seen = 0;
for (const line of lines) {
  const m = /^(\S+) ([^\s:]+)(?:: (.*))?$/s.exec(line);
  if (m === null) { bad.push(`no form: ${line.slice(0, 200)}`); continue; }
  const [, outcome, name, rest] = m;
  const r = report.instances[name];
  if (r === undefined) { bump(outcome === "skip" ? "skip, not in the report" : `NOT IN REPORT ${outcome}`); continue; }
  seen++;
  if (r.outcome !== outcome) { bad.push(`${name}: tool ${outcome}, sweep ${r.outcome}`); continue; }
  if (outcome === "pass") { if (rest !== undefined) bad.push(`${name}: pass with text`); bump("pass"); continue; }
  const at = /^line (\d+):(?: - ("(?:[^"\\]|\\.)*")(\.\.\.)?)?(?: \+ ("(?:[^"\\]|\\.)*")(\.\.\.)?)?$/s.exec(rest ?? "");
  if (at === null) {
    if (rest !== r.reason) bad.push(`${name}: reason ${JSON.stringify(rest)} against ${JSON.stringify(r.reason)}`);
    else bump(`${outcome}: reason alone: ${r.reason.replace(/\d+/g, "n").slice(0, 70)}`);
    continue;
  }
  const n = Number(at[1]);
  const expected = at[2] === undefined ? undefined : JSON.parse(at[2]);
  const actual = at[4] === undefined ? undefined : JSON.parse(at[4]);
  const inReason = /, line (\d+)$/.exec(r.reason);
  if (inReason === null) {
    // No two texts: the first line of the one side.
    if (r.reason === "no diagnostic where the oracle has a baseline" && n === 1 && expected !== undefined && actual === undefined) bump("fail: line 1 of the oracle alone");
    else if (/diagnostics where the oracle has none/.test(r.reason) && n === 1 && expected === undefined && actual !== undefined) bump("fail: line 1 of the baseline alone");
    else bad.push(`${name}: a line where the reason is ${r.reason}`);
    continue;
  }
  if (Number(inReason[1]) !== n) { bad.push(`${name}: line ${n}, the reason says ${inReason[1]}`); continue; }
  const diff: string[] = r.diff.split("\n");
  const minus = diff.find(l => l.startsWith("- "))?.slice(2);
  const plus = diff.find(l => l.startsWith("+ "))?.slice(2);
  const cut = (s: string | undefined, dots: string | undefined) => (s === undefined ? undefined : dots === undefined ? display(s) : undefined);
  const e = cut(expected, at[3]);
  const a = cut(actual, at[5]);
  if (expected === undefined ? minus !== undefined : e !== undefined && e !== minus) { bad.push(`${name}: - ${JSON.stringify(e)} against ${JSON.stringify(minus)}`); continue; }
  if (actual === undefined ? plus !== undefined : a !== undefined && a !== plus) { bad.push(`${name}: + ${JSON.stringify(a)} against ${JSON.stringify(plus)}`); continue; }
  bump(`fail: line and both sides (${r.reason.split(" differs")[0]})${expected === undefined ? ", oracle ends" : ""}${actual === undefined ? ", baseline ends" : ""}`);
}
for (const [k, n] of [...count].sort()) console.log(String(n).padStart(6), k);
console.log(`lines ${lines.length}, in the report ${seen} of ${Object.keys(report.instances).length}, not the same ${bad.length}`);
for (const b of bad.slice(0, 15)) console.log("  " + b);
