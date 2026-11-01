// Object.assign stores a text into a field of numbers and a number into a field of texts. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function f30(o: { a: number; b: string }): unknown { return [o.a + 1, o.b.length]; }
const o30 = { a: 1, b: "xy" }; for (let i = 0; i < 30; i++) f30({ a: i, b: "" }); Object.assign(o30, { a: "text", b: 5 }); show(f30(o30));
export {};
