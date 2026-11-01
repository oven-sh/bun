// `() => [1, 2, 3]`: the arrays of a literal of constants share one storage where no store reaches them, and one cell stands for all where nothing tells two of them apart.
// So do the data of `new Set([..])` and `new Map([..])`. Here one evaluation is written, closed or told apart from another.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { set, map } from "./m.mjs";
const a = set(), b = set(), p = map(), q = map();

say(() => (() => { const s = new Set([NaN, NaN, 0, -0, "0"]); const m = new Map([[NaN, 1], [NaN, 2], [0, 3], [-0, 4]]); return [s.size, [...s].map(x => Object.is(x, -0) ? "-0" : String(x)).join("/"), m.size, m.get(NaN), m.get(0), [...m.keys()].map(x => Object.is(x, -0) ? "-0" : String(x)).join("/")].join(" "); })());
