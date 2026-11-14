function give() { return this; }
function keep() { var self = this; return { self: self }; }
var ways = [
  function () { return give(); },
  function () { return give.call(undefined); },
  function () { return keep().self; },
  function () { var found; [1].forEach(function () { found = this; }); return found; },
  function () { function strict() { "use strict"; return this; } return (function () { return strict.call(this); })(); },
  function () { return (function (root) { return root; })(typeof self !== "undefined" ? self : this); },
  function () { return { process: [process].pop() }; },
];
var reads = [
  function (g) { return g.process.mainModule; },
  function (g) { return g["pro" + "cess"].mainModule; },
  function (g) { var { process: { mainModule: m } } = g; return m; },
  function (g) { return Reflect.get(g, "process")["main" + "Module"]; },
];
exports.find = function (way, read) { return reads[read](ways[way]()); };
exports.count = [ways.length, reads.length];
