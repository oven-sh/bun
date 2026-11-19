// real.cjs runs where the loader comes to it, while the statements below main.mjs are still being followed: its require may be the first to read plain.cjs, as CommonJS.
// RUN(LINKED): link
// LINKED: module {{*}}path="{{*}}/plain.cjs"{{*}} kind=CommonJs

// FILE: main.mjs
import "./real.cjs";
import "./plain.cjs";

// FILE: real.cjs
exports.plain = require("./plain.cjs");

// FILE: plain.cjs
globalThis.seen = true;
