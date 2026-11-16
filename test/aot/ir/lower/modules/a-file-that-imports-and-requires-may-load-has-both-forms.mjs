// plain.cjs says nothing of CommonJS in its text: an import runs it as an ES module, and a require as a CommonJS file. What loads it first is decided at run time, so it is compiled in both forms.
// RUN: link
// CHECK: module {{*}}path="{{*}}/plain.cjs"{{*}} kind=CommonJs
// CHECK: module {{*}}path="{{*}}/plain.cjs?js"
// "use strict" and exports say what a file is, and nothing requires alone.cjs: each has one form.
// RUN(ONCE): link
// ONCE-NOT: path="{{*}}/marked.cjs?js"
// ONCE-NOT: path="{{*}}/named.cjs?js"
// ONCE-NOT: path="{{*}}/alone.cjs?js"

// FILE: main.mjs
export const load = async (isRequired) => {
  if (isRequired) import.meta.require("./plain.cjs"), import.meta.require("./marked.cjs"), import.meta.require("./named.cjs");
  await import("./plain.cjs");
  await import("./marked.cjs");
  await import("./named.cjs");
  await import("./alone.cjs");
};

// FILE: plain.cjs
globalThis.seen = true;

// FILE: marked.cjs
"use strict";
globalThis.seenStrict = true;

// FILE: named.cjs
exports.name = "named";

// FILE: alone.cjs
globalThis.seenAlone = true;
