// A file that threw is asked for again, by a name that the program puts together, through loaders that are handed on. The text that spells the file stands behind the throw.
"use strict";
globalThis.kept = [];
globalThis.start = "./li";
globalThis.rest = "b.cjs";
globalThis.own = require;
const loaders = [
  require.bind(null),
  (name) => globalThis.own(name),
  (name) => require("node:module").prototype.require.call(module, name),
  (name) => eval("require(name)"),
  (name) => new Function("require", "name", "return require(name)")(require, name),
];
function show() {
  for (const k of globalThis.kept) console.log(k.tell(), k.box.bump(), new k.Box(5).get(), globalThis.kept.map((o) => Number(o.box instanceof k.Box)).join(""));
}
process.on("uncaughtException", (error) => {
  console.log("uncaught", error.message);
  show();
  for (const load of loaders) {
    const m = load(globalThis.start + globalThis.rest);
    console.log("again", m.run, m.tell(), new m.Box(1).bump());
    show();
  }
});
const lib = require("./lib.cjs");
globalThis.name = "./lib.cjs";
console.log("not reached", lib.run);
