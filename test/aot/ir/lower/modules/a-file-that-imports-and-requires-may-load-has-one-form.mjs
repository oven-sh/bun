// The extension, the exports or else the package say what a file is, whichever of import() and require() loads it first.
// A record says its kind where the module is no ES module.
// RUN(PLAIN): link
// PLAIN: module {{*}}path="{{*}}/plain.jsx" displayPath="{{*}}plain.jsx" flags=
// RUN(ONCE): link
// ONCE-NOT: path="{{*}}/plain.jsx?jsx"
// ONCE-NOT: path="{{*}}/marked.cjs?js"
// ONCE-NOT: path="{{*}}/named.cjs?js"
// ONCE-NOT: path="{{*}}/alone.jsx?jsx"

// FILE: main.mjs
export const load = async (isRequired) => {
  if (isRequired) import.meta.require("./plain.jsx"), import.meta.require("./marked.cjs"), import.meta.require("./named.cjs");
  await import("./plain.jsx");
  await import("./marked.cjs");
  await import("./named.cjs");
  await import("./alone.jsx");
};

// FILE: plain.jsx
void __filename;
globalThis.seen = true;

// FILE: marked.cjs
globalThis.seenMarked = true;

// FILE: named.cjs
exports.name = "named";

// FILE: alone.jsx
void __filename;
globalThis.seenAlone = true;

// FILE: package.json
{ "type": "module" }
