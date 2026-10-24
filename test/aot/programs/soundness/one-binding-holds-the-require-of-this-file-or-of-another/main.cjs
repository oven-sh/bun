// One binding holds the `require` of this file or that of another file. Both load a built-in module, and only one of them is the `require` of this file.
const inner = require("./inner/give.cjs");
const path = require("node:path");
for (const turn of [0, 1, 0, 1]) {
  let load = require;
  if (turn) load = inner.give();
  console.log(turn, load === require, load("node:path") === path, load === module.require, load.main === module);
}
