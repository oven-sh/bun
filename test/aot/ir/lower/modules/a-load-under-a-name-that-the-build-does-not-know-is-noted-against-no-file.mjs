// plain.cjs says nothing of CommonJS in its text. real.cjs runs amid the statements of main.mjs and holds a require under a name of which the build knows nothing.
// That brings no other file amid the statements: the require of main.mjs runs when the statements below main.mjs have loaded plain.cjs, as an ES module.
// RUN(LINKED): link
// A record says its kind where the module is no ES module.
// LINKED: module {{*}}path="{{*}}/plain.cjs" displayPath="{{*}}plain.cjs" flags=

// FILE: main.mjs
import "./real.cjs";
import "./middle.mjs";
export const again = () => require("./middle.mjs");

// FILE: real.cjs
exports.load = name => require(name);

// FILE: middle.mjs
import "./plain.cjs";

// FILE: plain.cjs
globalThis.seen = true;
