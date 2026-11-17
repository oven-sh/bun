// An untyped package and a program of it (ropes): text wrapped, aligned, boxed; differences of lines; distances; cases; a rope that is built and cut
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var r = new lib.Rope(''), plain = ''; for (var i = 0; i < 160; i++) { var t = ['x' + i, 'some longer text ' + i, '', '\n'][i % 4], at = (i * 37) % (plain.length + 1); if (i % 3 === 0) { r = r.concat(t); plain += t; } else if (i % 7 === 5) { var e = Math.min(plain.length, at + 9); r = r.slice(0, at).concat(r.slice(e, r.length)); plain = plain.slice(0, at) + plain.slice(e); } else { r = r.insert(at, t); plain = plain.slice(0, at) + t + plain.slice(at); } if (i % 16 === 15) say(i, r.length, r.depth, r.toString() === plain, r.leaves([]).length, JSON.stringify(r.charAt(at >> 1)), JSON.stringify(r.slice(3, 20).toString()), r.balance().toString() === plain); }
