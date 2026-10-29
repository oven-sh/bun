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
