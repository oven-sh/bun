// Reads the raw runs of the release build and counts what the brief asks of (a), (b), (c).
import { readFileSync } from "node:fs";
const recs = readFileSync("/tmp/dcc/raw-release.jsonl", "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const head = /^(?:(\S.*?)\((\d+),(\d+)\): )?(error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/s;
const by = new Map<string, number>();
const inc = (k: string, n = 1) => by.set(k, (by.get(k) ?? 0) + n);
const samples = new Map<string, string[]>();
const sample = (k: string, v: string) => { const s = samples.get(k) ?? []; if (s.length < 8) s.push(v); samples.set(k, s); };
const command = new Set(["syntax", "cannot-read-file", "unsupported-extension", "internal-error", "internal-stand-in"]);
for (const r of recs) {
  if (r.notLaid !== undefined) { inc(`${r.kind} notLaid`); continue; }
  if (r.threw !== undefined) { inc(`${r.kind} threw`); continue; }
  const lines = r.stderr === "" ? [] : r.stderr.split("\n").slice(0, -1);
  const kinds = new Set<string>();
  let bad = false;
  for (const l of lines) {
    const m = head.exec(l);
    if (m === null) { if (!/^  /.test(l)) bad = true; continue; }
    const name = m[5] !== undefined ? "TS" : m[6];
    const cls = name === "TS" ? "ts" : command.has(name) ? name : "rule:" + name;
    kinds.add(`${m[4]} ${cls}${m[1] === undefined ? " (no file)" : ""}`);
  }
  const key = `${r.kind} exit ${r.exitCode}${r.signal ? " signal " + r.signal : ""}${r.stdout ? " stdout" : ""}${bad ? " BADLINE" : ""} :: ${[...kinds].sort().join(" + ") || "(nothing)"}`;
  inc(key);
  sample(key, r.name);
}
for (const [k, n] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(String(n).padStart(6), k, n <= 30 ? "   e.g. " + (samples.get(k) ?? []).join(", ") : "");
