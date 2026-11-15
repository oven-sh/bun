// STATISTIC: LazyFillsMadeRare >= 3
// Places that a loop fills where they are empty: static fields, fields of constants, variables, captured variables; filled before, in the first iteration, later, emptied in between, filled with nothing.
// @ts-nocheck
const out: unknown[] = [];
class Config { private static inst: Config | null = null; static made = 0; static get(): Config { return Config.inst ??= new Config(); } static reset(): void { Config.inst = null; } factor = 3; constructor() { Config.made++; } }
function scale(x: number): number { return x * Config.get().factor; }
let t = 0; for (let k = 0; k < 100; k++) { t += scale(k & 7); if (k === 50) Config.reset(); }
out.push(t, Config.made);
const cache = { table: null as number[] | null, fills: 0 };
function look(k: number): number { if (cache.table === null) { cache.table = [1, 2, 3, 4]; cache.fills++; } return cache.table[k & 3]; }
let n = 0; for (let k = 0; k < 40; k++) { n += look(k); if (k % 10 === 9) cache.table = null; }
out.push(n, cache.fills);
let late: number | undefined; let calls = 0;
function fill(k: number): number { if (late === undefined) { calls++; if (k > 5) late = k; } return late ?? -1; }
let m = 0; for (let k = 0; k < 20; k++) m += fill(k);
out.push(m, calls);
function once(f: () => number) { let v: number | undefined; return () => v ??= f(); }
const g = once(() => { calls++; return 7; });
let s = 0; for (let k = 0; k < 20; k++) s += g();
out.push(s, calls);
const holder = { v: undefined as unknown }; function nothing() { return holder.v ??= null; }
for (let k = 0; k < 3; k++) out.push(nothing());
try { for (let k = 0; k < 3; k++) { if (cache.table === null) cache.table = (() => { throw new Error("no"); })(); } } catch (e) { out.push(e.message); }
console.log(out.join());
