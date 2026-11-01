// reverse() swaps the two types of a pair. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function use(t: [number, string]): string { return (t[0] + 1) + "|" + t[1].length; }
const t2: [number, string] = [1, "abc"]; for (let i = 0; i < 30; i++) use([i, "x"]);
show(use(t2)); t2.reverse(); let r: unknown; try { r = use(t2); } catch (e) { r = "throws"; } show(r, typeof t2[0], typeof t2[1]);
export {};
