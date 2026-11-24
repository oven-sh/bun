// wide.mjs holds stars to two CommonJS files, so only the run knows which of them brings `round`. last.mjs hands `round` on from wide.mjs by a statement, and wide.mjs holds a star back to last.mjs.
// In that ring the name of last.mjs got the answer of wide.mjs, "the run follows the stars", and a name with that answer got no entry: the file's own statement was dropped,
// and the run looked for `round` behind the stars of last.mjs: undefined, not listed.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/last.mjs"{{*}}exports=[{name="round" kind=Indirect module={{*}} importName="round"}]

// FILE: main.mjs
import * as last from "./last.mjs";
console.log(last.round);

// FILE: last.mjs
export { round } from "./wide.mjs";
export * from "./deep.cjs";

// FILE: wide.mjs
export * from "./last.mjs";
export * from "./more.cjs";
export * from "./third.cjs";

// FILE: deep.cjs
exports.only = "only";

// FILE: more.cjs
exports.round = 5;

// FILE: third.cjs
exports.other = 1;
