// A copy by the keys of the source brings a member too many, and a text into a field of numbers. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
interface Rec { a: number; b: number }
function copy(from: Rec, to: Rec): void { for (const k of Object.keys(from) as (keyof Rec)[]) to[k] = from[k]; }
function f36(r: Rec): number { return r.a + r.b; }
for (let i = 0; i < 30; i++) f36({ a: i, b: i }); const src = { a: 1, b: 2, c: "extra" }; const wide36 = { a: "x", b: 2 }; const to36: Rec = { a: 0, b: 0 }; copy(src, to36); show(f36(to36), Object.keys(to36)); copy(wide36 as unknown as Rec, to36); show(f36(to36));
export {};
