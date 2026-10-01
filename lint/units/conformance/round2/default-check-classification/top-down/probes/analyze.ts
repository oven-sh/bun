// Classifies the raw survey with the proposed rules and prints the distribution.
import { readFileSync } from "node:fs";
import { parsePlainDiagnostics } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/tsc_plain_format";

const path = process.argv[2];
const recs = readFileSync(path, "utf8")
  .split("\n")
  .filter(l => l !== "")
  .map(l => JSON.parse(l));
const notRules = new Set(["syntax", "cannot-read-file", "unsupported-extension", "internal-error", "internal-stand-in"]);
const count = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const show = (title: string, m: Map<string, number>, top = 40) => {
  console.log(title);
  for (const [k, n] of [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top)) console.log(`  ${String(n).padStart(6)}  ${k}`);
  if (m.size > top) console.log(`  ... ${m.size - top} more`);
};

const exits = new Map<string, number>();
const classes = new Map<string, number>();
const byKindClass = new Map<string, number>();
const codes = new Map<string, number>();
const codeInstances = new Map<string, number>();
const ruleInstances = new Map<string, number>();
const deaths: any[] = [];
const timeouts: any[] = [];
const slow: any[] = [];
const syntaxTexts = new Map<string, number>();
const warnTexts = new Map<string, number>();
let silentC = 0,
  silentE = 0,
  cOnlyRules = 0,
  eOnlyRules = 0;
const samples = new Map<string, string[]>();
for (const r of recs) {
  count(exits, `exit ${r.exitCode} signal ${r.signal}${r.timedOut ? " (timed out)" : ""}${r.notLaid ? " not laid out" : ""}${r.threw ? " threw" : ""}`);
  let cls: string;
  if (r.notLaid !== undefined) cls = "unsupported (not laid out)";
  else if (r.threw !== undefined) cls = "runner threw";
  else if (r.timedOut) {
    cls = "timeout";
    timeouts.push(r);
  } else if (r.signal !== null) cls = "crash: signal";
  else if (r.exitCode === 1) cls = "crash: refusal (exit 1)";
  else if (r.exitCode !== 0 && r.exitCode !== 2) cls = "crash: exit code";
  else if (r.stdout !== "") cls = "crash: stdout";
  else {
    const parsed = parsePlainDiagnostics(r.stderr);
    if (!parsed.ok) cls = "crash: stderr is no diagnostic text";
    else {
      const errors = parsed.diagnostics.filter(d => d.category === "error").length;
      if (r.exitCode === 0 && errors > 0) cls = "crash: exit 0 with errors";
      else if (r.exitCode === 2 && errors === 0) cls = "crash: exit 2 without error";
      else {
        const seen = new Set<string>();
        let rules = 0,
          foreign = 0,
          ts = 0,
          internal = 0,
          standIn = 0;
        for (const d of parsed.diagnostics) {
          const code = d.code !== undefined ? `TS${d.code}` : d.rule!;
          const key = `${d.category} ${d.code !== undefined ? "TS<n>" : notRules.has(d.rule!) ? d.rule : "<rule> " + d.rule}${d.path === undefined ? " (no file)" : ""}`;
          count(codes, key);
          seen.add(key);
          if (d.code !== undefined) ts++;
          else if (d.rule === "internal-stand-in") standIn++;
          else if (d.rule === "internal-error") internal++;
          else if (notRules.has(d.rule!)) foreign++;
          else if (d.path === undefined) foreign++;
          else rules++;
          if (d.rule === "syntax" && d.category === "error") count(syntaxTexts, d.messageText.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "n").slice(0, 90));
          if (d.rule === "syntax" && d.category !== "error") count(warnTexts, `${d.category}: ` + d.messageText.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "n").slice(0, 90));
          if (d.next !== undefined) count(codes, "(has a chain)");
        }
        for (const k of seen) count(codeInstances, k);
        if (internal > 0) cls = "fail: internal-error";
        else if (foreign > 0) cls = "fail: a diagnostic that is no TypeScript diagnostic";
        else if (standIn > 0) cls = "provisional";
        else if (ts === 0) {
          if (r.kind === "C") {
            cls = "pass (C: nothing to compare)";
            if (rules > 0) cOnlyRules++;
            else silentC++;
          } else {
            cls = "fail: no diagnostic where the oracle has a baseline";
            if (rules > 0) eOnlyRules++;
            else silentE++;
          }
        } else cls = "compare";
        if (rules > 0) count(ruleInstances, `${r.kind} instances with rule reports`);
      }
    }
  }
  count(classes, cls);
  count(byKindClass, `${r.kind} ${cls}`);
  if (cls.startsWith("crash")) deaths.push({ ...r, cls });
  if (!samples.has(cls)) samples.set(cls, []);
  if (samples.get(cls)!.length < 4) samples.get(cls)!.push(r.name);
  if (r.ms > 3000) slow.push([r.name, r.ms]);
}
console.log(`records ${recs.length}`);
show("exit codes and signals", exits);
show("classes", classes);
show("classes by oracle class", byKindClass);
show("diagnostic lines by kind (lines)", codes, 60);
show("diagnostic kinds (instances that have one)", codeInstances, 60);
show("rule reports", ruleInstances);
console.log(`C silent ${silentC}, C with only rule reports ${cOnlyRules}; E silent ${silentE}, E with only rule reports ${eOnlyRules}`);
show("syntax error texts (lines)", syntaxTexts, 25);
show("syntax warnings and messages (lines)", warnTexts, 25);
console.log("samples:");
for (const [k, v] of samples) console.log(`  ${k}: ${v.join(", ")}`);
console.log(`slow (>3 s): ${slow.length}`, slow.slice(0, 10));
console.log(`timeouts: ${timeouts.length}`, timeouts.map(t => t.name).slice(0, 20));
console.log(`deaths: ${deaths.length}`);
for (const d of deaths.slice(0, 60)) {
  console.log(`--- ${d.cls}: ${d.name} [${d.casePath}] exit ${d.exitCode} signal ${d.signal} stderr ${d.stderrBytes} bytes, roots ${JSON.stringify(d.roots)}`);
  console.log(d.stderr.split("\n").slice(0, Number(process.argv[3] ?? 6)).map((l: string) => "    " + l.slice(0, 300)).join("\n"));
}
