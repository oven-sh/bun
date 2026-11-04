// The function that a field of an object holds is made when the field is first read. Here the run time reads the field, not compiled code.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { make } from "./m.mjs";
const o = make();
say(() => (() => { const p = make(); return Object.keys(o).filter(k => typeof o[k] === "function").map(k => o[k] === p[k]).join("/"); })());
