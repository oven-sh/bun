// real.cjs, which runs while the statements below main.mjs are followed, requires the ES module side.mjs. The loader behind that require reads what STATEMENTS lead to from side.mjs: helper.cjs.
// helper.cjs holds a require of plain.cjs, which says nothing of CommonJS in its text: a require names it there, no statement imports it. So to the statement of main.mjs it stays an ES module, which has its turn.
// RUN(PLAIN): link
// PLAIN: module {{*}}path="{{*}}/plain.cjs"{{*}} kind=CommonJs flags=[{{*}}IsModuleToImports
// other.cjs is such a file too, and a statement of side.mjs imports it: the loader behind the require may be the first to read it, as CommonJS.
// RUN(OTHER): link
// OTHER: module {{*}}path="{{*}}/other.cjs"{{*}} kind=CommonJs flags=[KeepsError{{*}}] exportRule
// RUN(ONCE): link
// ONCE: IsModuleToImports
// ONCE-NOT: IsModuleToImports

// FILE: main.mjs
import "./real.cjs";
import "./plain.cjs";
import "./other.cjs";

// FILE: real.cjs
exports.side = require("./side.mjs");
exports.other = () => require("./other.cjs");

// FILE: side.mjs
import "./helper.cjs";
import "./other.cjs";
export {};

// FILE: helper.cjs
exports.load = () => require("./plain.cjs");

// FILE: plain.cjs
globalThis.seen = true;

// FILE: other.cjs
globalThis.seenToo = true;
