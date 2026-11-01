// The function that a field of an object holds is made when the field is first read. Here the run time reads the field, not compiled code.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
const o = require("./m.cjs");
const make = () => o;
say(() => (() => { Object.freeze(o); return [Object.isFrozen(o), Object.entries(o).map(([k, v]) => k + ":" + typeof v).join("/")].join(" "); })());
