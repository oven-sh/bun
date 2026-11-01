// A field of numbers gets a text, null and undefined and is deleted, each through a wider second name. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function twice(b: { v: number }): number { return b.v * 2; }
const box: { v: number } = { v: 4 }; for (let i = 0; i < 30; i++) twice({ v: i });
const wider: { v: number | string } = box; wider.v = "text"; show(twice(box), typeof box.v);
const nullable: { v: number | null } = box; nullable.v = null; show(twice(box), box.v);
const optional: { v?: number } = box; delete optional.v; show(twice(box), "v" in box); optional.v = undefined; show(twice(box), "v" in box);
export {};
