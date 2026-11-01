// A switch over a union of texts meets a text outside it. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
type K = "a" | "b"; function f31(k: K): unknown { switch (k) { case "a": return 1; case "b": return 2; default: { const n: never = k; return ["never", n]; } } }
function g31(k: K): number { if (k === "a") return 1; return k.length; }
for (let i = 0; i < 30; i++) { f31("a"); g31("b"); } const s31: string = ["c", "c"].join(""); show(f31(s31 as K), g31(s31 as K), f31(JSON.parse('"zz"')));
export {};
