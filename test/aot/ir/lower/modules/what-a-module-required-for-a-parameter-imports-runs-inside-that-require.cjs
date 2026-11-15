// tools.cjs requires what it is handed, and main.cjs hands it "./plug.mjs". What plug.mjs imports runs inside that require, so plain.cjs, which says nothing
// of its kind, is a CommonJS file, as it is where main.cjs writes require("./plug.mjs"). setup.cjs says as little, and only an import() is handed its name: it is read as an import reads it.
// RUN: link
// CHECK-NOT: path="{{*}}/setup.cjs"{{*}} kind=CommonJs
// CHECK: path="{{*}}/plain.cjs"{{*}} kind=CommonJs
// CHECK-NOT: path="{{*}}/setup.cjs"{{*}} kind=CommonJs

// FILE: main.cjs
const tools = require("./tools.cjs");
console.log(tools.load("./plug.mjs").kind);
tools.bring("./setup.cjs");

// FILE: tools.cjs
exports.load = (name) => require(name);
exports.bring = (name) => import(name);

// FILE: plug.mjs
import "./plain.cjs";
export const kind = globalThis.madeUpKind;

// FILE: plain.cjs
globalThis.madeUpKind = (function () { return this === undefined ? "strict" : "sloppy"; })();

// FILE: setup.cjs
globalThis.madeUpSetup = (function () { return this === undefined ? "strict" : "sloppy"; })();
