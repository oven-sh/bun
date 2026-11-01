// `instanceof` narrows an object to a class whose prototype was laid under it later. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class P34 { v = 1; m(): string { return "p"; } } class Q34 { w = "q"; m(): string { return "q" + this.w.length; } }
function f34(x: P34 | Q34): unknown { if (x instanceof Q34) return [x.w.length, x.m()]; return [x.v + 1, x.m()]; }
for (let i = 0; i < 30; i++) { f34(new P34()); f34(new Q34()); } const x34 = new P34(); Object.setPrototypeOf(x34, Q34.prototype); let r34: unknown; try { r34 = f34(x34); } catch (e) { r34 = "throws " + (e as Error).constructor.name; } show(r34);
export {};
