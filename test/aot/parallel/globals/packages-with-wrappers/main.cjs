// Packages whose wrappers test for define, window, self and global.
var d = require("./define-first.cjs"), w = require("./window-last.cjs"), g = require("./global-last.cjs");
function run(k) {
  var t = 0;
  for (var i = 0; i < k; i++) { t += d.sum(new d.Node(i).add(new d.Node(1))); t += new w.Pair(i, 2).total; t += new g.api.Box(i).twice(); t += new globalLast.Box(1).n; }
  return t;
}
console.log(run(100), typeof defineFirst, typeof lib, globalLast === g.api);
globalThis.define = function (names, factory) { console.log("defined", names, typeof factory); }; globalThis.define.amd = {};
d.Node.prototype.add = function () { return this; }; console.log(run(10));
globalLast.Box.prototype.twice = function () { return "t"; }; console.log(run(3));
globalThis.window = globalThis; console.log(typeof window, typeof define, run(1));
