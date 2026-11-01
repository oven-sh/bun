// A getter narrowed by typeof answers otherwise at the next read. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Flip { private n = 0; get v(): number | string { return this.n++ % 2 ? "text" : 1; } }
function f15(o: Flip): unknown { if (typeof o.v === "number") return o.v + 1; return "string"; }
function g15(o: Flip): unknown { if (typeof o.v === "number") return o.v.toFixed(1); return "string"; }
let r15: unknown; try { r15 = g15(new Flip()); } catch (e) { r15 = "throws " + (e as Error).constructor.name; } show(f15(new Flip()), r15);
export {};
