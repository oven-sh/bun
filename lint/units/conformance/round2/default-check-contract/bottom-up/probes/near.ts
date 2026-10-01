// Classifies the raw runs of the release build by class, exit code and the names of the codes on stderr.
import { readFileSync } from "node:fs";
const commandCodes = new Set(["syntax", "cannot-read-file", "unsupported-extension", "internal-error", "internal-stand-in"]);
const head = /^(?:(\S.*?)\((\d+),(\d+)\): )?(error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/s;
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const by = new Map<string, number>();
const samples = new Map<string, string[]>();
const names = new Map<string, { diagnostics: number; instances: number }>();
let notLaid = 0;
for (const l of lines) {
  const r = JSON.parse(l);
  if (r.exitCode === undefined) { notLaid++; continue; }
  const kinds = new Set<string>();
  const seen = new Set<string>();
  for (const line of r.stderr.split("\n").filter(Boolean)) {
    const m = head.exec(line);
    if (m === null) { kinds.add(line.startsWith("  ") ? "chain" : "NOFORM"); continue; }
    const name = m[5] !== undefined ? "TS" : m[6];
    const isRule = m[5] === undefined && !commandCodes.has(m[6]) && m[1] !== undefined;
    const k = `${m[4]} ${m[5] !== undefined ? "TS" : isRule ? "<rule>" : m[6]}${m[1] === undefined ? " (no file)" : ""}`;
    kinds.add(k);
    const key = `${r.kind} ${m[4]} ${name}`;
    const n = names.get(key) ?? { diagnostics: 0, instances: 0 };
    n.diagnostics++;
    if (!seen.has(key)) { seen.add(key); n.instances++; }
    names.set(key, n);
  }
  const key = `${r.kind} exit ${r.exitCode}${r.signal ? " signal " + r.signal : ""}${r.stdout ? " STDOUT" : ""}: ${kinds.size === 0 ? "(stderr empty)" : [...kinds].sort().join(" + ")}`;
  by.set(key, (by.get(key) ?? 0) + 1);
  const s = samples.get(key) ?? [];
  if (s.length < 3) s.push(`${r.name} [${r.roots.join(",")}]`);
  samples.set(key, s);
}
console.log("records", lines.length, "not laid out", notLaid);
for (const [k, n] of [...by].sort()) console.log(String(n).padStart(6), k, "  e.g.", samples.get(k)!.join("; "));
console.log("by class, category and name: diagnostics / instances");
for (const [k, n] of [...names].sort()) console.log(" ", k.padEnd(40), n.diagnostics, "/", n.instances);
