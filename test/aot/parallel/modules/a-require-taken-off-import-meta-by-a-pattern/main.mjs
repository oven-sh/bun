// A require() that a pattern takes off import.meta loads its files.
const { require, dir, url } = import.meta;
const { port } = require("./dock.json");
console.log(port, require("./crane.cjs").lift(4), require("./crane.cjs") === require("./crane.cjs"), typeof dir, typeof url);
const { require: load } = import.meta;
console.log(load("./dock.json") === require("./dock.json"), load("./crane.cjs").name);
function later(name) {
  return load(name === "dock" ? "./dock.json" : "./crane.cjs");
}
console.log(later("dock").port, later("crane").name);
const meta = import.meta;
console.log(meta.require("./dock.json").port, meta.require("./crane.cjs").lift(1), typeof meta.dir);
