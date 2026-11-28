// plain.mjs says nothing of its kind in its text, and its package says "type": "commonjs". It is the ES module that it is by its name, in an executable and in a program that runs in place.
// plain.js is CommonJS by its package.
// uses.mjs and bare/uses.mjs use `require` and have no `import`, `export` or `await`: they are ES modules too, whatever their packages say.
// RUN(USES): link
// USES: module {{*}}path="{{*}}/uses.mjs" displayPath="uses.mjs" flags=
// RUN(BARE): link
// BARE: module {{*}}path="{{*}}/bare/uses.mjs" displayPath="bare/uses.mjs" flags=
// RUN(EXECUTABLE): link
// A record says its kind where the module is no ES module.
// EXECUTABLE: module {{*}}path="{{*}}/plain.mjs" displayPath="{{*}}plain.mjs" flags=
// RUN(BOUND): link
// BOUND: module {{*}}path="{{*}}/plain.js"{{*}} kind=CommonJs
// RUN(INPLACE): link
// OPTIONS(INPLACE): runs-in-place
// INPLACE: module {{*}}path="{{*}}/plain.mjs" displayPath="{{*}}plain.mjs" flags=

// FILE: main.mjs
import "./plain.mjs";
import "./plain.js";
import "./uses.mjs";
import "./bare/uses.mjs";
export const again = () => require("./plain.mjs");

// FILE: plain.mjs
globalThis.seen = true;

// FILE: uses.mjs
globalThis.used = require("./plain.js");

// FILE: bare/uses.mjs
globalThis.usedToo = require("../plain.js");

// FILE: bare/package.json
{ "name": "bare" }

// FILE: plain.js
globalThis.seenToo = true;

// FILE: package.json
{ "type": "commonjs" }
