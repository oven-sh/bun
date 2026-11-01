// `() => [1, 2, 3]`: the arrays of a literal of constants share one storage where no store reaches them, and one cell stands for all where nothing tells two of them apart.
// So do the data of `new Set([..])` and `new Map([..])`. Here one evaluation is written, closed or told apart from another.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { set, map } from "./m.mjs";
const a = set(), b = set(), p = map(), q = map();
Set.prototype.add.call(a, 9); Map.prototype.set.call(p, "z", 0);
say(() => [a.size, b.size, set().size, p.size, q.size, map().size].join());
