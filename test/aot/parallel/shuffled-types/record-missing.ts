// A Record is asked for keys that it lacks, and for names of Object.prototype. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function f25(r: Record<string, number>, k: string): number { return r[k]! + 1; }
function g25(r: Record<string, { v: number }>, k: string): unknown { return r[k]!.v; }
for (let i = 0; i < 30; i++) { f25({ a: i }, "a"); g25({ a: { v: i } }, "a"); }
let r25: unknown; try { r25 = g25({}, "zz"); } catch (e) { r25 = "throws " + (e as Error).constructor.name; } show(f25({}, "zz"), r25, f25({}, "toString") === f25({}, "toString"), typeof f25({}, "constructor"));
export {};
