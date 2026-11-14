// An untyped package and a program of it (lines): a table of expressions tried in turn; the groups of the first that matches are copied by index, upward and downward
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var r = new lib.Reader(), texts = ['x = 1', 'total += a * b', 'print(x, y)', 'a.b.c()', 'for i in list', 'for k in keys by 2 if k > 3', '2026-11-12', '2026-11-12T10:20', '2026-01-02T03:04:05.678Z', '2026-01-02T03:04:05+0100', '1..10', '-2.5..3', 'word', '?? nothing', '', 'for in'];
for (var i = 0; i < 6; i++) {
  r.read(texts.map(function (t) { return i ? t.replace(/\d/g, function (d) { return (+d + i) % 10; }) : t; })).forEach(function (m, k) { say(i, k, m.rule, JSON.stringify(m.groups), m.down.join('|'), m.index); });
  say(JSON.stringify(r.count));
}
