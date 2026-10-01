import { readFileSync } from "node:fs";
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
const names: string[] = [];
for (let k = 0; k < 131; k++) names.push("option" + k);
const a: Record<string, unknown> = {};
for (const n of names) a[n] = 0;
const k = structuredClone(a);
const part = (from: number, to: number) => { const o: Record<string, unknown> = {}; for (const n of names.slice(from, to)) o[n] = 0; return o; };
const l = { ...part(0, 50), ...part(50, 100), ...part(100, 131) };
const o = Object.defineProperties({}, Object.fromEntries(names.map(n => [n, { value: 0, writable: true, enumerable: true, configurable: true }])));
const c = new Function(`return {${names.map(n => `${n}: 0`).join(", ")}}`)();
// q: a template that a literal of 60 fields started, with the rest added by name
const q: Record<string, unknown> = new Function(`return {${names.slice(0, 60).map(n => `${n}: 0`).join(", ")}}`)();
for (const n of names.slice(60)) q[n] = 0;
// r: a dictionary used as a prototype once, then cloned
const r: Record<string, unknown> = {};
for (const n of names) r[n] = 0;
Object.create(r);
const N = 15000;
const bench = (label: string, make: () => unknown) => {
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const t = cpu();
    for (let i = 0; i < N; i++) make();
    best = Math.min(best, cpu() - t);
  }
  console.log(`${label.padEnd(52)} ${best.toFixed(1).padStart(6)} ms per ${N} (${((best * 1000) / N).toFixed(2)} us each)`);
};
bench("a filled by name", () => ({ ...a }));
bench("c literal (new Function)", () => ({ ...c }));
bench("k structuredClone of a", () => ({ ...k }));
bench("l spread of three parts of at most 50", () => ({ ...l }));
bench("o Object.defineProperties", () => ({ ...o }));
bench("q literal of 60, the rest by name", () => ({ ...q }));
bench("r filled by name, then a prototype once", () => ({ ...r }));
