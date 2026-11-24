// last.mjs hands `round` on from wide.mjs by a statement; wide.mjs holds a star back to it and stars to two CommonJS files, so only the run knows who brings the name.
// outer.mjs holds a star over last.mjs. last.mjs has no star of its own, so the run did not follow that star, and a name whose answer is
// "the run follows the stars" gets no entry in outer.mjs: the name was lost: undefined off the namespace, a SyntaxError by name.
// The run now follows the star of outer.mjs.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/outer.mjs"{{*}}requests=[{target={{*}} isDynamicStarExport=true

// FILE: main.mjs
import * as outer from "./outer.mjs";
console.log(outer.round);

// FILE: outer.mjs
export * from "./last.mjs";

// FILE: last.mjs
export { round } from "./wide.mjs";

// FILE: wide.mjs
export * from "./last.mjs";
export * from "./first.cjs";
export * from "./second.cjs";

// FILE: first.cjs
exports.round = 5;

// FILE: second.cjs
exports.other = 1;
