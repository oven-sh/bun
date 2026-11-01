// A parameter declared boolean is handed a number, a text, null and NaN. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function f41(b: boolean): unknown { return [b === true, b === false, b ? 1 : 2, !b, b && "and", typeof b]; }
for (let i = 0; i < 30; i++) f41(i % 2 === 0); show(f41(1 as unknown as boolean), f41("" as unknown as boolean), f41(null as unknown as boolean), f41(NaN as unknown as boolean));
export {};
