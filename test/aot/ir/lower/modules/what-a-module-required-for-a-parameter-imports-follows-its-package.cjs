// tools.cjs requires or imports what it is handed. plain.jsx and setup.jsx say nothing of their kind, so their package does.
// A record says its kind where the module is no ES module.
// RUN(PLAIN): link
// PLAIN: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=
// RUN(SETUP): link
// SETUP: module {{*}}path="{{*}}/setup.jsx" displayPath="{{*}}setup.jsx" flags=

// FILE: main.cjs
const tools = require("./tools.cjs");
console.log(tools.load("./plug.mjs").kind);
tools.bring("./setup.jsx");

// FILE: tools.cjs
exports.load = (name) => require(name);
exports.bring = (name) => import(name);

// FILE: plug.mjs
import "./plain.jsx";
export const kind = globalThis.madeUpKind;

// FILE: plain.jsx
void __filename;
globalThis.madeUpKind = (function () { return this === undefined ? "strict" : "sloppy"; })();

// FILE: setup.jsx
void __filename;
globalThis.madeUpSetup = (function () { return this === undefined ? "strict" : "sloppy"; })();

// FILE: package.json
{ "type": "module" }
