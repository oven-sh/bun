// Both names come out of config.json. A require() takes the first: what plug.mjs imports runs inside that require, so plain.cjs, which says nothing of its kind,
// is a CommonJS file, as it is where main.cjs writes require("./plug.mjs"). An import() takes the second: setup.cjs says as little and is read as an import reads it.
// RUN: link
// CHECK-NOT: path="{{*}}/setup.cjs"{{*}} kind=CommonJs
// CHECK: path="{{*}}/plain.cjs"{{*}} kind=CommonJs
// CHECK-NOT: path="{{*}}/setup.cjs"{{*}} kind=CommonJs

// FILE: main.cjs
const config = require("./config.json");
console.log(require(config.plugin).kind);
import(config.setup);

// FILE: config.json
{ "plugin": "./plug.mjs", "setup": "./setup.cjs" }

// FILE: plug.mjs
import "./plain.cjs";
export const kind = globalThis.madeUpKind;

// FILE: plain.cjs
globalThis.madeUpKind = (function () { return this === undefined ? "strict" : "sloppy"; })();

// FILE: setup.cjs
globalThis.madeUpSetup = (function () { return this === undefined ? "strict" : "sloppy"; })();
