// real.cjs requires the ES module side.mjs. Neither what a statement of side.mjs imports nor what a file below it requires becomes CommonJS by that.
// A record says its kind where the module is no ES module.
// RUN(PLAIN): link
// PLAIN: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=
// RUN(OTHER): link
// OTHER: module {{*}}path="{{*}}/other.jsx" displayPath="{{*}}other.jsx" flags=

// FILE: main.mjs
import "./real.cjs";
import "./plain.jsx";
import "./other.jsx";

// FILE: real.cjs
exports.side = require("./side.mjs");
exports.other = () => require("./other.jsx");

// FILE: side.mjs
import "./helper.cjs";
import "./other.jsx";
export {};

// FILE: helper.cjs
exports.load = () => require("./plain.jsx");

// FILE: plain.jsx
void __filename;
globalThis.seen = true;

// FILE: other.jsx
void __filename;
globalThis.seenToo = true;

// FILE: package.json
{ "type": "module" }
