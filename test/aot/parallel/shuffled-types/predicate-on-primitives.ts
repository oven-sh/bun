// A type predicate says text of a number, a list, an object and a boolean. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function isText(v: unknown): v is string { return v !== null; }
function f19(v: unknown): unknown { if (isText(v)) return [v.length, v + "!"]; return "no"; }
for (let i = 0; i < 30; i++) f19("x" + i); show(f19(5), f19([1, 2]), f19({ length: "L" }), f19(undefined === null ? 0 : true));
export {};
