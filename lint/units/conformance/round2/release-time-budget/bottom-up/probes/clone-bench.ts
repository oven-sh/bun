// How fast is a copy of an object of 132 properties, by how the object was made? CPU time of the main thread per 15,000 copies.
import { readFileSync } from "node:fs";
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
const names: string[] = [];
for (let k = 0; k < 97; k++) names.push("tristate" + k);
for (let k = 0; k < 20; k++) names.push("string" + k);
for (let k = 0; k < 6; k++) names.push("array" + k);
for (let k = 0; k < 6; k++) names.push("enum" + k);
for (let k = 0; k < 2; k++) names.push("number" + k);
names.push("paths");
const zeroOf = (name: string) => (name.startsWith("tristate") || name.startsWith("enum") ? 0 : name.startsWith("string") ? "" : undefined);
// a: assigned by computed key, as tsconfig.ts does
const a: Record<string, unknown> = {};
for (const n of names) a[n] = zeroOf(n);
// b: Object.fromEntries
const b = Object.fromEntries(names.map(n => [n, zeroOf(n)]));
// c: an object literal made by the compiler of a function
const c = new Function(`return {${names.map(n => `${n}: ${JSON.stringify(zeroOf(n))}`).join(", ")}}`)();
// d: the spread of a
const d = { ...a };
// e: a class whose constructor assigns by computed key
class E { constructor() { for (const n of names) (this as any)[n] = zeroOf(n); } }
// f: JSON.parse (undefined cannot be held: null stands in)
const f = JSON.parse(JSON.stringify(Object.fromEntries(names.map(n => [n, zeroOf(n) ?? null]))));
const N = 15000;
const bench = (label: string, make: () => unknown) => {
  for (let round = 0; round < 3; round++) {
    const t = cpu();
    let keep: unknown;
    for (let k = 0; k < N; k++) keep = make();
    const ms = cpu() - t;
    if (round === 0 || round === 2) console.log(`${label.padEnd(44)} round ${round + 1}: ${ms.toFixed(1)} ms per ${N} (${((ms * 1000) / N).toFixed(2)} us each) ${Object.keys(keep as object).length} keys`);
  }
};
bench("a {...assigned by computed key}", () => ({ ...a }));
bench("b {...Object.fromEntries}", () => ({ ...b }));
bench("c {...object literal}", () => ({ ...c }));
bench("d {...spread of a}", () => ({ ...d }));
bench("e new class with a loop", () => new E());
bench("f {...JSON.parse}", () => ({ ...f }));
bench("g Object.assign({}, a)", () => Object.assign({}, a));
bench("h Object.assign({}, c)", () => Object.assign({}, c));
bench("i Object.create(a)", () => Object.create(a));
bench("j structuredClone(c)", () => structuredClone(c));
