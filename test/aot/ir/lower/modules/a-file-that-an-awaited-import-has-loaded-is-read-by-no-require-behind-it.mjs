// plain.jsx has nothing of CommonJS but `__filename`, in a package of type module: to the loader behind `import` it is an ES module, to the one behind `require` CommonJS. The import() is awaited at the top of main.mjs:
// middle.mjs and what its statements lead to are loaded when the require behind it runs, so that require reads nothing.
// RUN(LINKED): link
// A record says its kind where the module is no ES module.
// LINKED: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=

// FILE: main.mjs
await import("./middle.mjs");
globalThis.again = require("./middle.mjs");

// FILE: middle.mjs
import "./plain.jsx";

// FILE: plain.jsx
void __filename;
globalThis.seen = true;

// FILE: package.json
{ "type": "module" }
