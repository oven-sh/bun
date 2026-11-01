// A field narrowed in front of a loop is set to null in its first turn. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function f17(o: { v: number | null }, h: (i: number) => void): unknown { let s = 0; if (o.v !== null) { for (let i = 0; i < 3; i++) { s += o.v; h(i); } } return s; }
const o17: { v: number | null } = { v: 5 }; for (let i = 0; i < 30; i++) f17({ v: i }, () => {}); show(f17(o17, i => { if (i === 0) o17.v = null; }));
export {};
