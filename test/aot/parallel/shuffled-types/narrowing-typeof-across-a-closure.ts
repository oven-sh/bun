// A variable narrowed by typeof is assigned by a closure before it is used. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function f14(): unknown { let x: number | string = 1; const flip = () => { x = "text"; }; if (typeof x === "number") { flip(); return x.toFixed(1); } return "string"; }
function g14(): unknown { let x: number | string = 1; const flip = () => { x = "text"; }; if (typeof x === "number") { flip(); return x + 1; } return "string"; }
let r14: unknown; try { r14 = f14(); } catch (e) { r14 = "throws " + (e as Error).constructor.name; } show(r14, g14());
export {};
