// plain.cjs says nothing of CommonJS in its text: to the loader behind `import` it is an ES module, to the one behind `require` CommonJS. The import() is awaited at the top of main.mjs:
// middle.mjs and what its statements lead to are loaded when the require behind it runs, so that require reads nothing.
// RUN(LINKED): link
// A record says its kind where the module is no ES module.
// LINKED: module {{*}}path="{{*}}/plain.cjs" displayPath="{{*}}plain.cjs" flags=

// FILE: main.mjs
await import("./middle.mjs");
globalThis.again = require("./middle.mjs");

// FILE: middle.mjs
import "./plain.cjs";

// FILE: plain.cjs
globalThis.seen = true;
