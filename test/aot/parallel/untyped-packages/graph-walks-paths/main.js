// An untyped package and a program of it (paths): graphs by maps of arrays: shortest paths with a heap, order, components, spanning trees, flows, cycles and colors
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var g = new lib(false), seed = 5; function r(n) { seed = (seed * 48271) % 2147483647; return seed % n; } for (var i = 0; i < 40; i++) { g.edge('n' + r(14), 'n' + r(14), i % 7 === 6 ? 0.5 + r(4) : 1 + r(9)); if (i % 8 === 7) { var from = g.order[r(g.order.length)], p = g.paths(from); say(i, from, g.order.map(function (t) { return t + ':' + p.dist[t]; }).join(' '), (p.to(g.order[0]) || ['none']).join('>'), p.visits, g.paths(from, function () { return 1; }, g.order[0]).visits, g.spanning().total, g.spanning().used.length); } if (i === 20) say(g.remove('n3'), g.remove('zz'), g.order.length); }
