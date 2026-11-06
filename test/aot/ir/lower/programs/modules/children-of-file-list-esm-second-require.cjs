// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 10
// STATISTIC: SourceFilesData = 1

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

// GENERATED: load names
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|object flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v3 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="names"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 captures=[{type=undefined|null|[[f_2]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="map"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="map" calleeName="list.map"
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
