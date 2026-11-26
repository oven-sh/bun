// Both names come out of config.json. A require() takes the first and an import() the second. plain.jsx and setup.jsx say nothing of their kind, so their package does.
// A record says its kind where the module is no ES module.
// RUN(PLAIN): link
// PLAIN: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=
// RUN(SETUP): link
// SETUP: module {{*}}path="{{*}}/setup.jsx" displayPath="{{*}}setup.jsx" flags=

// FILE: main.cjs
const config = require("./config.json");
console.log(require(config.plugin).kind);
import(config.setup);

// FILE: config.json
{ "plugin": "./plug.mjs", "setup": "./setup.jsx" }

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
