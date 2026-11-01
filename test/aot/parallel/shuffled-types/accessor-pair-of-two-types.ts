// A getter declared to give a number gives the text that its setter, declared wider, was handed. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Size { private raw: number | string = 1; get v(): number { return this.raw as number; } set v(x: number | string) { this.raw = x; } }
function f28(s: Size): number { return s.v * 2; }
for (let i = 0; i < 30; i++) f28(new Size()); const s28 = new Size(); s28.v = "text"; show(f28(s28), typeof s28.v);
export {};
