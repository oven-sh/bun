// An untyped package and a program of it (nan steps): records whose fields begin as small integers and become fractions, large, missing, texts or big on later turns
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
function walk(from, to, step) { var out = [], x = from, n = 0; while (x < to) { out.push(x); x += step; if (++n > 12) break; } return out.join() + ' end ' + x; } function count(o) { var n = 0; for (o.i = 0; o.i < o.max; o.i += o.by) { n++; if (n > 20) return 'many ' + o.i; } return n + ' ' + o.i; } var steps = [1, 2, 0.5, NaN, -1, 0, Infinity, 1e9, 2 ** 31, '1', null, undefined, true, -0]; steps.forEach(function (s, i) { say(i, walk(0, 5, s), '|', walk(2147483640, 2147483650, s), '|', walk(-3, i, s), '|', count({ max: 6, by: s }), '|', count({ max: i % 2 ? 4.5 : '3', by: s })); }); for (var k = 0; k < 6; k++) { var o = { max: 4, by: 1, get i() { return this._i; }, set i(v) { this._i = k > 3 ? v + 0.5 : v; } }; say(k, count(o), o._i); }
