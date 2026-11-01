// Assertion functions that check nothing: what is behind them is typed by their word alone. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function assertNumber(v: unknown): asserts v is number {}
function f20(v: unknown): unknown { assertNumber(v); return [v + 1, v * 2]; }
function assertSet<T>(v: T | null): asserts v is T {}
function g20(o: { s: string } | null): unknown { assertSet(o); return o.s; }
for (let i = 0; i < 30; i++) { f20(i); g20({ s: "x" }); }
let r20: unknown; try { r20 = g20(null); } catch (e) { r20 = "throws " + (e as Error).constructor.name; } show(f20("7"), f20(null), r20);
export {};
