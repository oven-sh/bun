// No file names the module object of the entry point. A sloppy `this` leads to it, and from there to the exports of another file.
var lib = require("./lib.cjs"), ways = require("./ways.cjs");
console.log(lib.run(10));
for (var way = 0; way < ways.count[0]; way++) {
  for (var read = 0; read < ways.count[1]; read++) {
    var found = ways.find(way, read), child = found && found.children.find(function (it) { return it.filename.endsWith("lib.cjs"); });
    if (!child) { console.log(way, read, typeof found); continue; }
    child.exports.state.n = way + read / 4;
    console.log(way, read, lib.run(10), child.exports === lib);
  }
}
var m = ways.find(0, 0).children.find(function (it) { return it.filename.endsWith("lib.cjs"); });
m.exports.Point.prototype.sum = function () { return "text"; }; console.log(lib.run(2));
delete m.exports.state.n; console.log(String(lib.run(1)));
