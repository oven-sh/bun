// An untyped package and a program of it (texts): a balanced tree with ranges, iteration both ways, deletion, ranks; and a skip list that must say the same
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var by = [undefined, function (a, b) { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0); }, function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); }], words = 'the quick Brown fox jumps Over the lazy dog and THE cat sat on a Mat while it rained all day long'.split(' '); by.forEach(function (f, n) { var t = new lib.Tree(f), s = new lib.Skip(f); words.forEach(function (w, i) { var o = t.set(w, (t.get(w) || 0) + 1); s.set(w, i); if (i % 4 === 3) say(n, i, o, t.size, s.size, t.at(1).key, t.rank(w), t.delete(words[i - 3]), s.delete(words[i - 3]), [...s].map(function (e) { return e[0]; }).join()); }); var m = new Map(t); say(n, [...m.keys()].join(), t.root.count, t.range('b', 'p', function () {}), [...t.back()].join()); var [first, ...rest] = t; say(first.join(), rest.length); t.set('zzz', { n: n }); say(JSON.stringify(t.get('zzz')), t.at(99)); });
