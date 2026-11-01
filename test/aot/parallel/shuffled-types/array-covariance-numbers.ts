// A list of numbers gets texts through a second name under which it is a list of numbers or texts. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function total(ns: number[]): number { let s = 0; for (let i = 0; i < ns.length; i++) s += ns[i]!; return s; }
const ns: number[] = [1, 2, 3]; for (let i = 0; i < 30; i++) total([i, i]);
const wide: (number | string)[] = ns; wide.push("x"); wide[0] = "y"; show(total(ns), ns);
export {};
