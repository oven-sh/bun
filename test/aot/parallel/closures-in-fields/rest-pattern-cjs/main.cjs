// The function that a field of an object holds is made when the field is first read. Here the run time reads the field, not compiled code.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
const o = require("./m.cjs");
const make = () => o;
say(() => (() => { const { n, ...rest } = o; return Object.entries(rest).map(([k, v]) => k + ":" + typeof v).join("/"); })());
