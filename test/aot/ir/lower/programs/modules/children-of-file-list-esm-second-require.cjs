// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 10
// STATISTIC: SourceFilesData = 1
// CHECK-LABEL: function {{*}}name="load"
// CHECK-LABEL: function {{*}}name="names"

// FILE: main.cjs
// The children of a file list an es module from its second require on.
const { basename } = require("node:path");
const names = list => list.map(child => basename(child.filename)).join();
const first = require("./module.mjs");
console.log("once", names(module.children));
require("./module.mjs");
console.log("twice", names(module.children));
const child = module.children[0];
console.log(basename(child.id), child.loaded, child.exports === first, child.exports.one, child.parent === module, child.children.length, Array.isArray(child.paths), typeof child.require, Object.keys(child).join());

require("./data.json");
console.log("data", names(module.children), module.children[1].loaded, JSON.stringify(module.children[1].exports), module.children[1].parent === module);

const a = require("./requires-it-first.cjs");
const b = require("./requires-it-second.cjs");
console.log("first", a.children(), "second", b.children());

function load() {
  return require("./in-a-function.mjs");
}
for (let turn = 0; turn < 3; turn++) {
  load();
  console.log("turn", turn, names(module.children));
}

const list = module.children;
require("./behind-the-list.mjs");
console.log(list.length);
require("./behind-the-list.cjs");
console.log(list.length);
require("./behind-the-list.mjs");
require("./behind-the-list.mjs");
require("./behind-the-list.cjs");
console.log(names(list));

for (let turn = 0; turn < 3; turn++) {
  try {
    require("./throws.mjs");
  } catch (error) {
    console.log("threw", error.message, list.length);
  }
}

import("./imported.mjs").then(() => {
  require("./imported.mjs");
  console.log("imported, required once", list.length);
  require("./imported.mjs");
  console.log("imported, required twice", names(list));
  // Nobody holds what these two calls answer.
  console.log(list.at(-1).exports.unread);
});

// FILE: behind-the-list.cjs
exports.one = 1;

// FILE: behind-the-list.mjs
export default 1;

// FILE: data.json
{ "a": 1 }

// FILE: imported.mjs
export const unread = "read through the list of children alone";

// FILE: in-a-function.mjs
export default 1;

// FILE: module.mjs
export const one = 1;

// FILE: requires-it-first.cjs
require("./shared.mjs");
exports.children = () => module.children.length;

// FILE: requires-it-second.cjs
const { basename } = require("node:path");
require("./shared.mjs");
exports.children = () => module.children.map(child => basename(child.filename) + " of " + basename(child.parent.filename)).join();

// FILE: shared.mjs
export const shared = true;

// FILE: throws.mjs
throw new Error("as always");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
