// The function that a field holds is CALLED before anything reads the field. It sees the same function object that the field gives later, and what it captured.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { make } from "./m.mjs";
const o = make();
const s = `${o}`, v = o + 1;
say(() => [s, v, o.toString.hits, o.valueOf.hits].join());
