// The function that a field holds is CALLED before anything reads the field. It sees the same function object that the field gives later, and what it captured.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { make } from "./m.mjs";
const o = make();
const r = o.map(x => x.f());
say(() => [r.map((x, i) => x[0] === o[i].f).join(), r.map(x => x[1]).join(), o[0].f === o[1].f].join(" "));
