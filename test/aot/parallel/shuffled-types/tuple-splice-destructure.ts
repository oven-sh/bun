// A pair that was spliced and unshifted is taken apart by a parameter pattern. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function sum([a, b]: [number, number]): number { return a + b; }
const t4: [number, number] = [1, 2]; for (let i = 0; i < 30; i++) sum([i, 1]);
t4.splice(0, 1); show(sum(t4)); t4.length; t4.unshift(9, 8, 7); show(sum(t4), t4.length);
export {};
