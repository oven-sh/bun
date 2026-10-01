// Probe: the diagnostic codes of the oracle baselines: how many codes, how many instances per code, what a table by code holds.
import { readdirSync, readFileSync } from "node:fs";
const E = new URL("../../../error-baseline-format/top-down/", import.meta.url).pathname;
const { tsgoRules } = await import(E + "diagnosticwriter.ts");
const { readErrorBaseline } = await import(E + "reader.ts");
const root = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const byCode = new Map<number, number>();
const byCodeRegex = new Map<number, number>();
let files = 0, differ = 0, pretty = 0, single = 0, diagnosticsTotal = 0;
const t0 = performance.now();
const head = /^(?:[^\r\n]*?\((?:\d+|--),(?:\d+|--)\): )?(?:error|warning|suggestion|message) TS(-?\d+): /gm;
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(`${root}/${suite}`).filter(f => f.endsWith(".errors.txt")).sort()) {
    files++;
    const bytes = readFileSync(`${root}/${suite}/${f}`);
    const parsed = readErrorBaseline(tsgoRules, tsgoRules.model.fromBytes(bytes));
    if (parsed.pretty) pretty++;
    const codes = new Set<number>(parsed.diagnostics.map((d: any) => d.code));
    diagnosticsTotal += parsed.diagnostics.length;
    if (codes.size === 1) single++;
    for (const c of codes) byCode.set(c, (byCode.get(c) ?? 0) + 1);
    const text = bytes.toString("utf8");
    const end = text.search(/\r\n\r\n\r\n|\r\n\r\n====/);
    const first = end < 0 ? text : text.slice(0, end);
    const viaRegex = new Set<number>();
    for (const m of first.matchAll(head)) viaRegex.add(Number(m[1]));
    for (const c of viaRegex) byCodeRegex.set(c, (byCodeRegex.get(c) ?? 0) + 1);
    if (!parsed.pretty && (viaRegex.size !== codes.size || [...codes].some(c => !viaRegex.has(c)))) differ++;
  }
}
const sorted = [...byCode].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
console.log(`baselines ${files}, pretty ${pretty}, diagnostics ${diagnosticsTotal}, distinct codes ${byCode.size}, baselines with one code ${single}, ms ${(performance.now() - t0).toFixed(0)}`);
console.log("regex over the first section disagrees with the reader on", differ, "plain baselines");
console.log("top 15:", sorted.slice(0, 15).map(([c, n]) => `TS${c} ${n}`).join(", "));
console.log("codes in one baseline only:", sorted.filter(x => x[1] === 1).length, "in at most 3:", sorted.filter(x => x[1] <= 3).length, "in 10 or more:", sorted.filter(x => x[1] >= 10).length);
let cum = 0;
const total = sorted.reduce((a, b) => a + b[1], 0);
for (const k of [10, 25, 50, 100, 200]) { cum = sorted.slice(0, k).reduce((a, b) => a + b[1], 0); console.log(`top ${k} codes cover ${(100 * cum / total).toFixed(1)}% of (instance, code) pairs`); }
