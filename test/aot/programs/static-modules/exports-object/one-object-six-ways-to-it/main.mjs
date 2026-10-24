// `exports`, `module.exports`, top-level `this`, the default import, require() and import.meta.require() are one object.
import d from "./a.cjs";
const r = require("./a.cjs");
console.log(d.self, d === r, r.me() === r, import.meta.require("./a.cjs") === d);
