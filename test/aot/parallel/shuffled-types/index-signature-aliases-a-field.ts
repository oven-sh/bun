// A field declared a number is stored a text under a key put together at run time, through the index signature. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
interface Dict { [k: string]: number | string; id: number }
function f24(d: Dict): number { return d.id + 1; }
const d24: Dict = { id: 1 }; for (let i = 0; i < 30; i++) f24({ id: i }); const k24: string = ["i", "d"].join(""); d24[k24] = "text"; show(f24(d24), typeof d24.id);
export {};
