// A number outside an enum is assigned to it, which the checker allows. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
enum Color { Red, Green, Blue }
function name(c: Color): string { switch (c) { case Color.Red: return "red"; case Color.Green: return "green"; case Color.Blue: return "blue"; } }
function table(c: Color): string { return ["r", "g", "b"][c]!.toUpperCase(); }
for (let i = 0; i < 30; i++) { name(i % 3); table(i % 3); }
const n12: number = Number("7"); const c12: Color = n12; let r12: unknown; try { r12 = table(c12); } catch (e) { r12 = "throws"; } show(name(c12), r12, name(1.5 as Color), name(-0 as Color), name(NaN as Color));
export {};
