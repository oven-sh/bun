// outer.mjs holds two stars. other.mjs declares `round`. last.mjs hands `round` on from wide.mjs by a statement, and wide.mjs holds a star back to it and a star to ONE CommonJS file.
// With several such files the name behind the first star is left to a search at the run; with one it is known where it would come from, but not whether it is there.
// Either way they are two bindings under one name, and the language leaves the name out of outer.mjs. The run followed the stars of outer.mjs only in the first case, and answered 9 in the second.
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
export * from "./loose.cjs";

// FILE: loose.cjs
exports.round = 5;
