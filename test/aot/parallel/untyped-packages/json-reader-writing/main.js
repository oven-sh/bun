// An untyped package and a program of it (writing): a recursive reader with positions, comments allowed, reviver; and a writer with indents and cycles
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var cyc = { name: 'c', list: [] }; cyc.list.push(cyc, { up: cyc.list });
var vals = [1, 'q"\\\n\t\u0007\ud800', [undefined, function () {}, Symbol('s'), NaN, -0, 1e21], { a: undefined, b: new Date(0), c: { toJSON: function () { return ['j', this === vals[3].c]; } } }, cyc, [[], {}, [[]], { x: {} }], 10n, null, true];
[undefined, ' ', '--'].forEach(function (ind) { vals.forEach(function (v, i) { say(i, lib.write(v, ind)); }); });
for (var i = 0; i < 8; i++) { var o = {}; for (var j = 0; j <= i; j++) o['k' + (j * 3 % 5)] = j % 2 ? [j, o['k0']] : j / 4; var s = lib.write(o); say(i, s, lib.write(lib.parse(s)) === s); }
