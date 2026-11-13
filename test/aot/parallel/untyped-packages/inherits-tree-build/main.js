// An untyped package and a program of it (build): util.inherits and Function.prototype.call constructors, three levels, super calls by name, toString and valueOf
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var root = lib.Folder.create('root'), all = [root];
for (var i = 0; i < 30; i++) { var up = all[(i * 7) % all.length], n = i % 3 === 0 ? new lib.Folder('d' + i) : i % 3 === 1 ? new lib.Leaf('f' + i + '.txt', i % 2 ? i * 10 : undefined) : new lib.Link('l' + i, i % 4 ? all.filter(function (x) { return x.constructor === lib.Leaf; })[i % 2] : null); try { up.add(n); all.push(n); } catch (e) { say(e.name, e.message); } if (i % 6 === 5) root.open = !root.open; if (i % 5 === 0 && n instanceof lib.Link === false) say(i, root.size(), n.path(), String(n), n instanceof lib.Base, root.find(/(\d+)\./).join(' ')); }
var depths = []; root.visit(function (n, d) { depths.push(d + n.name[0]); }); say(depths.join()); say(all.filter(function (n) { return n > 50; }).map(String).join(), lib.Base.made, lib.Link.super_ === lib.Leaf, Object.keys(all[2]).join());
