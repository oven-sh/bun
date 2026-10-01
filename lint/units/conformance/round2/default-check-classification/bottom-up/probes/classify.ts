// usage: bun classify.ts <raw.jsonl>
import { parsePlainDiagnostics } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/tsc_plain_format";
const commandNames = new Set(["syntax", "cannot-read-file", "unsupported-extension", "internal-error", "internal-stand-in"]);
type Rec = { name: string; kind: "E" | "C"; casePath: string; notLaid?: string; roots?: string[]; ms?: number; exitCode?: number | null; signal?: string | null; stdout?: string; stderr?: string; stderrBytes?: number; threw?: string };
export function classify(r: Rec): { outcome: string; cause: string; detail: string; rules?: Record<string, number>; cats?: string } {
  if (r.threw !== undefined) return { outcome: "crash", cause: "runner threw", detail: r.threw };
  if (r.notLaid !== undefined) return { outcome: "unsupported", cause: "layout", detail: r.notLaid };
  const stderr = r.stderr ?? "", stdout = r.stdout ?? "";
  const first = (t: string) => (t.split("\n").find(l => l.trim() !== "") ?? "").slice(0, 160);
  if (r.signal != null) return { outcome: r.ms! >= 60000 ? "timeout" : "crash", cause: `signal ${r.signal}`, detail: first(stderr) };
  if (r.exitCode === 1) {
    if (stdout === "" && /^error: [^\n]+\n$/.test(stderr)) return { outcome: "unsupported", cause: "refusal", detail: first(stderr) };
    return { outcome: "crash", cause: "exit code 1", detail: first(stderr) };
  }
  if (r.exitCode !== 0 && r.exitCode !== 2) return { outcome: "crash", cause: `exit code ${r.exitCode}`, detail: first(stderr) };
  if (stdout !== "") return { outcome: "crash", cause: "stdout", detail: first(stdout) };
  const parsed = parsePlainDiagnostics(stderr);
  if (!parsed.ok) return { outcome: "crash", cause: "stderr", detail: `line ${parsed.at} is ${parsed.reason}: ${parsed.text.slice(0, 160)}` };
  const errors = parsed.diagnostics.filter(d => d.category === "error").length;
  if (r.exitCode === 0 && errors > 0) return { outcome: "crash", cause: "exit mismatch", detail: `exit 0 with ${errors} errors` };
  if (r.exitCode === 2 && errors === 0) return { outcome: "crash", cause: "exit mismatch", detail: "exit 2 without an error" };
  const rules: Record<string, number> = {};
  const named = new Map<string, { n: number; first: string }>();
  let ts = 0, standIns = 0;
  const cats = new Set<string>();
  for (const d of parsed.diagnostics) {
    const line = `${d.path !== undefined ? `${d.path}(${d.line},${d.character}): ` : ""}${d.category} ${d.rule ?? "TS" + d.code}: ${d.messageText}`;
    if (d.code !== undefined) { ts++; continue; }
    const rule = d.rule!;
    if (rule === "internal-stand-in") { standIns++; continue; }
    if (commandNames.has(rule) || d.path === undefined) {
      const key = commandNames.has(rule) ? rule : "unknown code";
      const e = named.get(key);
      if (e === undefined) named.set(key, { n: 1, first: line }); else e.n++;
      if (rule === "syntax") cats.add(d.category);
      continue;
    }
    rules[rule] = (rules[rule] ?? 0) + 1;
  }
  const more = { rules: Object.keys(rules).length > 0 ? rules : undefined, cats: [...cats].sort().join("+") };
  for (const key of ["internal-error", "unknown code", "cannot-read-file", "unsupported-extension", "syntax"]) {
    const e = named.get(key);
    if (e !== undefined) return { outcome: "fail", cause: key, detail: e.first.slice(0, 200) + (e.n > 1 ? ` (and ${e.n - 1} more)` : ""), ...more };
  }
  if (standIns > 0) return { outcome: "provisional", cause: "stand-in", detail: "", ...more };
  if (ts > 0) return { outcome: "compare", cause: "typescript", detail: `${ts} diagnostics`, ...more };
  if (r.kind === "C") return { outcome: "pass", cause: "", detail: "", ...more };
  return { outcome: "fail", cause: "nothing", detail: "no diagnostic where the oracle has a baseline", ...more };
}
if (import.meta.main) {
  const recs: Rec[] = (await Bun.file(process.argv[2]).text()).split("\n").filter(l => l !== "").map(l => JSON.parse(l));
  const by = new Map<string, { n: number; ex: string[] }>();
  const rules = new Map<string, { reports: number; instances: number }>();
  let passWithRules = 0;
  const syntaxCats = new Map<string, number>();
  const texts = new Map<string, number>();
  for (const r of recs) {
    const c = classify(r);
    const key = `${r.kind} ${c.outcome}${c.cause === "" ? "" : ` [${c.cause}]`}`;
    let e = by.get(key);
    if (e === undefined) by.set(key, (e = { n: 0, ex: [] }));
    e.n++;
    if (e.ex.length < 3) e.ex.push(`${r.name}: ${c.detail}`);
    for (const [name, n] of Object.entries(c.rules ?? {})) {
      const x = rules.get(name) ?? { reports: 0, instances: 0 };
      x.reports += n; x.instances++; rules.set(name, x);
    }
    if (c.outcome === "pass" && c.rules !== undefined) passWithRules++;
    if (c.cause === "syntax") syntaxCats.set(`${r.kind} ${c.cats}`, (syntaxCats.get(`${r.kind} ${c.cats}`) ?? 0) + 1);
    for (const line of (r.stderr ?? "").split("\n")) {
      const m = /: (error|warning|message|suggestion) syntax: (.*)$/.exec(line);
      if (m) { const t = `${m[1]}: ${m[2].replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "n").slice(0, 90)}`; texts.set(t, (texts.get(t) ?? 0) + 1); }
    }
  }
  console.log(`records ${recs.length}: E ${recs.filter(r => r.kind === "E").length}, C ${recs.filter(r => r.kind === "C").length}`);
  for (const [key, e] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`${String(e.n).padStart(6)}  ${key}`);
    if (process.argv.includes("--examples")) for (const x of e.ex) console.log(`          ${x.slice(0, 260)}`);
  }
  console.log("rules left out:", [...rules].map(([n, x]) => `${n} ${x.reports} reports in ${x.instances} instances`).join("; ") || "none");
  console.log(`class C passes that had reports of rules left out: ${passWithRules}`);
  console.log("syntax failures by categories present:", [...syntaxCats].map(([k, n]) => `${k}: ${n}`).join("; "));
  const ms = recs.map(r => r.ms ?? 0).sort((a, b) => a - b);
  console.log(`ms per process: median ${ms[ms.length >> 1]}, p99 ${ms[Math.floor(ms.length * 0.99)]}, max ${ms[ms.length - 1]}`);
  console.log(`stderr bytes: max ${Math.max(...recs.map(r => r.stderrBytes ?? 0))}`);
  if (process.argv.includes("--texts")) for (const [t, n] of [...texts].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${String(n).padStart(6)}  ${t}`);
}
