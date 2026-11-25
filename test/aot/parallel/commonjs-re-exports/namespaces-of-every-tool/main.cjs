// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 4
// `import * as leaf from "./leaf"` as Babel, swc and Rollup write it: a file that says it is an ES module is its own namespace.
const babel = require("./babel.cjs");
const swc = require("./swc.cjs");
const rollup = require("./rollup.cjs");
console.log(babel.sum(10), swc.sum(10), rollup.sum(10));
console.log(babel.name, swc.name, rollup.name);
console.log(babel.plain, swc.plain, rollup.plain);
