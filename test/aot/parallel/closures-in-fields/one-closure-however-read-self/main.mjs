// The function that a field of an object holds is made when the field is first read. Here the run time reads the field, not compiled code.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { make } from "./m.mjs";
const o = make();
say(() => (() => { const k = Object.keys(o).filter(k => typeof o[k] === "function"); return k.map(x => [o[x] === o[x], Object.values(o).includes(o[x]), Object.getOwnPropertyDescriptor(o, x).value === o[x], Reflect.get(o, x) === o[x]].join()).join("/"); })());
