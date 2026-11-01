// `instanceof` narrows to a class whose Symbol.hasInstance says yes to everything. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Real { v = 1; } class Fake { static [Symbol.hasInstance](v: unknown): boolean { return true; } w = 2; }
function f33(x: Real | Fake): unknown { if (x instanceof Fake) return x.w + 1; return x.v + 1; }
for (let i = 0; i < 30; i++) { f33(new Real()); } show(f33(new Real()), f33(new Fake()));
export {};
