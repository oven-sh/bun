// plain.jsx has nothing of CommonJS but `__filename`, in a package of type module. real.cjs runs amid the statements of main.mjs and holds a require under a name of which the build knows nothing.
// That brings no other file amid the statements: the require of main.mjs runs when the statements below main.mjs have loaded plain.jsx, as an ES module.
// RUN(LINKED): link
// A record says its kind where the module is no ES module.
// LINKED: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=

// FILE: main.mjs
import "./real.cjs";
import "./middle.mjs";
export const again = () => require("./middle.mjs");

// FILE: real.cjs
exports.load = name => require(name);

// FILE: middle.mjs
import "./plain.jsx";

// FILE: plain.jsx
void __filename;
globalThis.seen = true;

// FILE: package.json
{ "type": "module" }
