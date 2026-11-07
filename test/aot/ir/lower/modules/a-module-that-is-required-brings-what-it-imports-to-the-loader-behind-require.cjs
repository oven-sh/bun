// both.mjs is required, so the loader behind `require` follows its statements: it reads plain.cjs, as CommonJS. The require in both.mjs itself reads nothing.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/plain.cjs"{{*}} kind=CommonJs

// FILE: main.cjs
exports.both = require("./both.mjs");

// FILE: both.mjs
import "./plain.cjs";
export const plain = require("./plain.cjs");

// FILE: plain.cjs
globalThis.seen = true;
