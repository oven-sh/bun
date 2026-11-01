// `() => [1, 2, 3]`: the arrays of a literal of constants share one storage where no store reaches them, and one cell stands for all where nothing tells two of them apart.
// So do the data of `new Set([..])` and `new Map([..])`. Here one evaluation is written, closed or told apart from another.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { list, nested, texts, fractions } from "./m.mjs";
const a = list(), b = list();
Object.freeze(a);
say(() => { let wrote; try { b.push(9); b[0] = 8; wrote = "wrote"; } catch (e) { wrote = e.name; } return [Object.isFrozen(a), Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b), Object.isFrozen(list()), wrote, JSON.stringify(b)].join(" "); });
