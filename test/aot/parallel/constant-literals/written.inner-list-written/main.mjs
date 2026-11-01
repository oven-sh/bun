// `() => [1, 2, 3]`: the arrays of a literal of constants share one storage where no store reaches them, and one cell stands for all where nothing tells two of them apart.
// So do the data of `new Set([..])` and `new Map([..])`. Here one evaluation is written, closed or told apart from another.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { list, nested, texts, fractions } from "./m.mjs";
const a = list(), b = list();
const p = nested(), q = nested(); p[0][0] = 9; p[1].push(9);
say(() => [JSON.stringify(p), JSON.stringify(q), JSON.stringify(nested())].join(" "));
