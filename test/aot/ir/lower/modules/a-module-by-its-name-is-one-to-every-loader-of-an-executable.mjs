// plain.mjs says nothing of its kind in its text, and its package says "type": "commonjs". Where a statement imports a file, `bun run` asks the package alone: there plain.mjs is CommonJS.
// `bun build --compile` holds it as the ES module that it is by its name, and so does an executable. A program that runs in place answers as `bun run`.
// plain.js is CommonJS by its package in both.
// uses.mjs and bare/uses.mjs use `require` and have no `import`, `export` or `await`: where a statement imports them they are CommonJS to `bun run`, whatever their packages say, and in an executable too.
// RUN(USES): link
// USES: module {{*}}path="{{*}}/uses.mjs"{{*}} kind=CommonJs
// RUN(BARE): link
// BARE: module {{*}}path="{{*}}/bare/uses.mjs"{{*}} kind=CommonJs
// RUN(EXECUTABLE): link
// A record says its kind where the module is no ES module.
// EXECUTABLE: module {{*}}path="{{*}}/plain.mjs" displayPath="{{*}}plain.mjs" flags=
// RUN(BOUND): link
// BOUND: module {{*}}path="{{*}}/plain.js"{{*}} kind=CommonJs
// RUN(INPLACE): link
// OPTIONS(INPLACE): runs-in-place
// INPLACE: module {{*}}path="{{*}}/plain.mjs"{{*}} kind=CommonJs

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
