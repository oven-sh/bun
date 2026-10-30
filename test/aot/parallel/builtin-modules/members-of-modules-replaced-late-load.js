// A built-in module is loaded when the program first asks for it, not before. Whatever the program then puts in place of a member shows to everybody who looks the member up,
// and whoever took the original before keeps the original.
const path = require("node:path");
function viaMember(a, b) { return path.join(a, b); }
for (let i = 0; i < 2000; i++) viaMember("a", "b");
console.log(viaMember("a", "b"));
const original = path.join;
path.join = function () { return "replaced"; };
console.log(viaMember("a", "b"), original("a", "b"), require("node:path").join("x", "y"));
const { basename } = require("node:path");
path.basename = () => "other";
console.log(basename("/a/b.txt"), path.basename("/a/b"));
function late() {
  const os = require("node:os");
  const eol = os.EOL;
  const platform = os.platform;
  os.platform = () => "mine";
  return [typeof eol, os.platform(), typeof platform()].join();
}
console.log(late(), require("node:os").platform());
function lateUtil(value) {
  const util = require("node:util");
  return util.inspect(value) + " " + util.format("%s-%d", "a", 1);
}
console.log(lateUtil({ a: 1 }));
require("node:util").format = () => "format replaced";
console.log(lateUtil([1]));
function events() {
  const EventEmitter = require("node:events");
  const emitter = new EventEmitter();
  let seen = 0;
  emitter.on("x", () => seen++);
  emitter.emit("x");
  return seen;
}
console.log(events());
require("node:events").prototype.emit = function () { return "emit replaced"; };
console.log(events(), new (require("node:events"))().emit("x"));
import("node:querystring").then(querystring => {
  console.log(querystring.stringify({ a: 1 }));
  const cjs = require("node:querystring");
  cjs.stringify = () => "stringify replaced";
  console.log(cjs.stringify({ a: 1 }), require("node:querystring").stringify({ b: 2 }));
});
