// outer.mjs holds two stars. other.mjs declares `round`. last.mjs hands `round` on from wide.mjs by a statement, and wide.mjs holds a star back to it and stars to two CommonJS files,
// so only the run knows who brings that one. They are two bindings under one name: the language leaves the name out of outer.mjs: undefined off the namespace, a SyntaxError by name.
// The front end knows that the two must be compared at the run. But last.mjs has no star of its own, so the run did not follow the star over it, found the declared binding alone and answered 9.
// The run now follows the stars of outer.mjs.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/outer.mjs"{{*}}requests=[{target={{*}} isDynamicStarExport=true

// FILE: main.mjs
import * as outer from "./outer.mjs";
console.log(outer[process.argv[2] ?? "round"]);

// FILE: outer.mjs
export * from "./last.mjs";
export * from "./other.mjs";

// FILE: other.mjs
export const round = 9;

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
