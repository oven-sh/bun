// A parameter declared 0 | 1 is handed 2, -0 and a fraction. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
type Bit = 0 | 1; function f40(b: Bit): unknown { return [["zero", "one"][b], b === 0 ? "z" : "o", 1 - b]; }
for (let i = 0; i < 30; i++) f40((i & 1) as Bit); show(f40(2 as Bit), f40(-0 as Bit), f40(0.5 as Bit), f40(Number("1") as Bit));
export {};
