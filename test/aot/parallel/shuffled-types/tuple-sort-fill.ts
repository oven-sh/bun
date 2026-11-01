// sort, fill, copyWithin and shift move the members of a tuple to places of other types. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function first(t: [number, string, boolean]): number { return t[0] * 2; }
function third(t: [number, string, boolean]): number { return t[2] ? 1 : 2; }
const t3: [number, string, boolean] = [5, "a", false]; for (let i = 0; i < 30; i++) { first([i, "", true]); third([i, "", true]); }
t3.sort(); show(first(t3), third(t3), t3); t3.fill("z"); show(first(t3), third(t3), t3); t3.copyWithin(0, 1); t3.shift(); show(first(t3), third(t3), t3, t3.length);
export {};
