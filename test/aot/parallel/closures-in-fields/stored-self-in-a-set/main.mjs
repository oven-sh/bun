// The function that a field holds is CALLED before anything reads the field. It sees the same function object that the field gives later, and what it captured.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { make } from "./m.mjs";
const o = make();
import { all } from "./m.mjs";
o.f(); o.f();
say(() => [all.size, all.has(o.f)].join());
