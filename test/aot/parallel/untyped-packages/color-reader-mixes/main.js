// An untyped package and a program of it (mixes): colors by a table of expressions, each with its own reader of the groups
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var list = ['#f00', 'rgb(0,0,255)', 'hsl(90,50%,50%)', '#abcdef80', 'teal']; for (var i = 0; i < 25; i++) { var a = new lib(list[i % 5]), b = new lib(list[(i * 3 + 1) % 5]), m = a.mix(b, i / 24); say(i, m.hex(), m.kind, m.luminance.toFixed(6), m.mix(a, .5).hex()); if (i === 10) lib.readers.unshift({ re: /^#(f)(0)(0)$/, read: function (g) { return [1, 2, 3, g.length / 8]; } }); if (i === 18) lib.readers.shift(); }
