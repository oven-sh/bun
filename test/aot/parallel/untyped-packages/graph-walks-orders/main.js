// An untyped package and a program of it (orders): graphs by maps of arrays: shortest paths with a heap, order, components, spanning trees, flows, cycles and colors
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var sets = ['a>b b>c a>c d>a', 'x>y y>z z>x z>w w>q q>w', '1>2 2>3 3>4 10>1', 's>s', 'a>b c>d', '']; sets.forEach(function (t, i) { for (var k = 0; k < 3; k++) { var g = new lib(); t.split(' ').filter(Boolean).concat(k === 1 ? ['b>a'] : k === 2 ? ['new>a', 'c>new2'] : []).forEach(function (e, n) { var m = /^(\w+)>(\w+)$/.exec(e); g.edge(m[1], m[2], n + 1); }); var r; try { r = g.sorted().join(); } catch (e) { r = e.message + ' ' + e.cycle; } say(i, k, r, JSON.stringify(g.strong()), g.edges); } }); var f = new lib(); [['s', 'a', 10], ['s', 'b', 5], ['a', 'b', 15], ['a', 't', 4], ['b', 't', 10], ['s', 't', 1.5]].forEach(function (e) { f.edge(e[0], e[1], e[2]); var r = f.flow('s', 't'); say(e.join(), r.total, r.rounds); });
