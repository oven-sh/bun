// top.mjs holds one star, to outer.mjs. outer.mjs holds two: other.mjs declares `round`; last.mjs hands `round` on from wide.mjs by a statement, and only the run knows who brings that one.
// The name is compared at the run in outer.mjs, so it must be compared in top.mjs too. But the name behind the star of top.mjs is not itself left to the run: it is compared.
// The run did not follow that star, found the declared binding alone and answered 9 where the language leaves the name out.
// The run now follows the star of top.mjs as well.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/top.mjs"{{*}}requests=[{target={{*}} isDynamicStarExport=true

// FILE: main.mjs
import * as top from "./top.mjs";
console.log(top[process.argv[2] ?? "round"]);

// FILE: top.mjs
export * from "./outer.mjs";

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
