// Indices made of properties that loops read off objects of unknown classes: integers, whole doubles, fractions, what is no number.
// STATISTIC: IndexTermsReadAsIntegers >= 4
function make(x, y, z) { var o = JSON.parse('{"x":0,"y":0,"z":0}'); o.x = x; o.y = y; o.z = z; return o; }
function tables() { var t = { ints: new Int32Array(64), doubles: new Float64Array(96), bytes: new Uint8Array(64), list: [] }; for (var i = 0; i < 64; i++) { t.ints[i] = i * 3; t.bytes[i] = i * 7; t.list.push(i * 5); } return t; }
function sum(all, k, ints) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + ints[o.x + o.y]) | 0; } return s; }
function add(all, k, ints) { for (var i = 0; i < k; i++) { var o = all[i & 15]; ints[o.x + o.y] += o.z; } return ints.join(); }
function grid(all, k, doubles) { for (var i = 0; i < k; i++) { var o = all[i & 15]; doubles[o.y * 16 + o.x] += 1; } return doubles.join(); }
function difference(all, k, list) { var s = ""; for (var i = 0; i < k; i++) { var o = all[i & 15]; s += list[o.x - o.y]; } return s.length + s.slice(-30); }
function fill(all, k, list) { for (var i = 0; i < k; i++) { var o = all[i & 15]; list[o.y * 4 + o.x + 1] = i; } return list.join() + Object.keys(list).length; }
function alone(all, k, bytes) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + bytes[o.x]) | 0; } return s; }
var ints = new Int32Array(64), doubles = new Float64Array(96), bytes = new Uint8Array(64), list = [];
for (var i = 0; i < 64; i++) { ints[i] = i * 3; bytes[i] = i * 7; list.push(i * 5); }
function variables(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; ints[o.x + o.y] += o.z; doubles[o.y * 8 + o.x] += 1; s = (s + list[o.x - o.y] + bytes[o.x]) | 0; } return s + "," + ints.join() + "," + doubles.join(); }
var kinds = {
  ints: function (i) { return make(i & 7, i >> 2, 1); },
  whole: function (i) { return make((i + 0.5) * 2 - 1, (i + 1.5) * 2 - i - 3, 1.5 * 2); },
  some: function (i) { return make(i % 3 ? i & 7 : (i + 0.5) * 2 - i - 1, i % 4 ? 1 : 0.5 + 0.5, i); },
  fractions: function (i) { return make(i + 0.5, i % 2 ? 0.5 : 1, 2); },
  zeros: function (i) { return make(i % 2 ? -0 : 0, i % 3 ? -0 : 1, 2); },
  outside: function (i) { return make(i === 5 ? 70000 : i === 6 ? -3 : i, i === 7 ? NaN : 1, 2); },
  strings: function (i) { return make(i === 14 ? "7" : i, i === 15 ? "x" : 1, 2); },
  nothing: function (i) { return make(i === 13 ? undefined : i, i === 12 ? null : 1, 2); },
  objects: function (i) { return make(i === 11 ? { toString: function () { return "4"; } } : i, 1, 2); },
};
for (var name in kinds) {
  for (var f of [sum, add, grid, difference, fill, alone, variables]) {
    var all = []; for (var i = 0; i < 16; i++) all.push(kinds[name](i));
    var t = tables(), table = { sum: t.ints, add: t.ints, grid: t.doubles, difference: t.list, fill: t.list, alone: t.bytes }[f.name], out = [];
    for (var k of [8, 40, 400]) { try { out.push(f(all, k, table)); } catch (e) { out.push(e.name); } }
    console.log(name, f.name, out.join(";").slice(-240));
  }
}
