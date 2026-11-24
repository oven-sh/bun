// An untyped package and a program of it (numbers): a balanced tree with ranges, iteration both ways, deletion, ranks; and a skip list that must say the same
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var t = new lib.Tree(), s = new lib.Skip(), seed = 11; for (var i = 0; i < 240; i++) { seed = (seed * 48271) % 2147483647; var k = i < 80 ? seed % 60 : i < 160 ? (seed % 600) / 8 : -(seed % 40); if (i % 5 === 4) { var a = t.delete(k), b = s.delete(k); if (a !== b) say('differ', i); } else { var x = t.set(k, i), y = s.set(k, i); if (x !== y) say('differ set', i); } if (i % 20 === 19) { var sum = 0, n = t.range(-5, 30.5, function (k, v) { sum += k * v; }); say(i, t.size, s.size, t.root.height, t.turns, s.level, n, sum, t.at(t.size >> 1).key, t.rank(10), t.rank(t.at(3).key), t.get(k), [...t].join() === [...s].join(), [...t.back()].slice(0, 5).join()); } }
