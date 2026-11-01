// A method is called without its object, bound to another and called on a third. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Counter { n = 5; get(): number { return this.n; } static make(): Counter { return new Counter(); } }
function f27(f: () => number): unknown { try { return f(); } catch (e) { return "throws " + (e as Error).constructor.name; } }
const c27 = new Counter(); for (let i = 0; i < 30; i++) c27.get(); show(f27(c27.get), f27(c27.get.bind({ n: "other" } as unknown as Counter)), f27(() => c27.get.call({ n: 1.5 } as Counter)));
export {};
