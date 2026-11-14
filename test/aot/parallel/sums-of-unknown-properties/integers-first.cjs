// Sums under bit operators of properties that loops read off objects of unknown classes: integers, doubles, strings, objects that change the next property.
// STATISTIC: NumberPathsAfterReads >= 5
var calls = 0;
function make(x, y, z) { var o = JSON.parse('{"x":0,"y":0,"z":0}'); o.x = x; o.y = y; o.z = z; return o; }
function list(f) { var all = []; for (var i = 0; i < 16; i++) all.push(f(i)); return all; }
function two(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + o.x + o.y) | 0; } return s; }
function four(all, k) { var s = 1; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s - o.x + o.y - o.z + o.x) & 0xfffff; } return s; }
function product(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + o.x * o.y) | 0; } return s; }
function unsigned(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + o.x + o.y) >>> 0; } return s; }
function between(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; var a = s + o.x; o.y = i & 3; s = (a + o.y) | 0; } return s; }
function caught(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; try { s = (s + o.x + o.y) | 0; } catch (e) { s = (s + 1000) | 0; } } return s; }
var kinds = {
  ints: function (i) { return make(i, 3 - i, i & 1); },
  extremes: function (i) { return make(i & 1 ? 2147483647 : -2147483648, i & 2 ? 2147483647 : -2147483648, -1); },
  doubles: function (i) { return make(i + 0.5, 1.25, -0); },
  mixed: function (i) { return make(i % 3 ? i : i + 0.5, i % 4 ? 1 : 4294967296, i % 5 ? 0 : NaN); },
  strings: function (i) { return make(i === 14 ? "7" : i, i === 15 ? "a" : 1, 2); },
  nothing: function (i) { return make(i === 13 ? undefined : i, i === 12 ? null : 1, true); },
  objects: function (i) { var o = make(i, 1, 2); if (i === 11) o.x = { valueOf: function () { calls++; o.y = 100 + (calls & 7); return 3; } }; return o; },
  getters: function (i) { var o = make(i, 1, 2); if (i === 9) Object.defineProperty(o, "x", { get: function () { o.y = ++calls & 15; return 2; } }); return o; },
  throws: function (i) { return make(i, i === 10 ? { valueOf: function () { throw new RangeError("y"); } } : 1, 2); },
};
for (var name in kinds) {
  for (var f of [two, four, product, unsigned, between, caught]) {
    var all = list(kinds[name]), out = [];
    for (var k of [8, 40, 400]) { try { out.push(f(all, k)); } catch (e) { out.push(e.name); } }
    console.log(name, f.name, out.join(), calls);
  }
}
