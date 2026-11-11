// main.mjs reads two names off the namespace of outer.mjs by name, and nothing looks at the object. So the pass that finds which names are asked kept only those two in the table of outer.mjs.
// But `round` is declared behind one star and left to the run behind the other, over a statement of last.mjs: the build cannot say what it is, and the reach takes every export of outer.mjs for reached.
// The two passes parted, and the compiler stopped: "something looks at the object of outer.mjs, and nobody was seen to ask for all that `export *` brings it".
// A barrel with stars that comes, by stars and statements, to names left to the run is now asked whole.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/outer.mjs"{{*}}requests=[{target={{*}} isDynamicStarExport=true

// FILE: main.mjs
import * as outer from "./outer.mjs";
console.log(String(outer.round), String(outer.own));

// FILE: outer.mjs
export * from "./last.mjs";
export * from "./other.mjs";

// FILE: other.mjs
export const round = 9;

// FILE: last.mjs
export { round } from "./wide.mjs";
export const own = 1;

// FILE: wide.mjs
export * from "./last.mjs";
export * from "./first.cjs";
export * from "./second.cjs";

// FILE: first.cjs
exports.round = 5;

// FILE: second.cjs
exports.other = 7;
