// Stores that create a name over a default on the prototype, in loops, until something stops them.
var log = [], effects = 0;
function make(change) {
  function Hut(number) { this.number = number; }
  Hut.prototype.east = null; Hut.prototype.west = null; Hut.prototype.beds = 0;
  function link(hut, other, n) { for (var i = 0; i < n; i++) { var next = new Hut(i); next.west = other.east; next.east = hut; other.west = next; if (next.east && next.east.west) next.east.west = next.west; next.beds += i; hut = next; } return hut; }
  function walk(hut) { var sum = 0, steps = 0; while (hut && steps++ < 200) { sum = (sum * 31 + (hut.beds | 0) - hut.number) | 0; var beside = hut.east; if (!beside) break; if (beside.number > 3 && beside.west) { hut.east = beside.west; beside.west = null; } hut = beside; } return steps + " " + sum; }
  var a = new Hut(-1), b = new Hut(-2);
  log.push(walk(link(a, b, 30)));
  change(Hut, a, b);
  for (var turn = 0; turn < 3; turn++) { var c = new Hut(turn), d = new Hut(turn + 1); log.push(walk(link(c, d, 20)), Object.keys(c).join(), Object.keys(d).join(), String(c.east), String(d.beds)); }
}
make(function () {});
make(function (Hut) { Object.defineProperty(Hut.prototype, "east", { value: null, writable: false, configurable: true }); });
make(function (Hut) { Object.defineProperty(Hut.prototype, "beds", { get: function () { effects++; return 3; }, set: function (v) { effects += v; }, configurable: true }); });
make(function (Hut) { Object.freeze(Hut.prototype); });
make(function (Hut) { Object.defineProperties(Hut.prototype, { west: { value: undefined, writable: false, enumerable: true } }); });
make(function (Hut) { Object.setPrototypeOf(Hut.prototype, { get east() { effects++; return null; } }); });
make(function (Hut) { Reflect.defineProperty(Hut.prototype, "east", { value: null, configurable: true }); delete Hut.prototype.east; });
make(function (Hut, a, b) { Object.freeze(a); Object.preventExtensions(b); delete Hut.prototype.west; Hut.prototype.west = 0; });
// One shape, orders of fields that differ by their count alone.
function Pair(key) { this.key = key; }
Pair.prototype.first = undefined; Pair.prototype.second = undefined; Pair.prototype.third = undefined;
function fill(i) { var p = new Pair(i); if (i & 1) p.second = i; if (i & 2) p.first = -i; if (!(i & 1)) p.second = i * 0.5; if (i % 3) p.third = p; if (!(i & 2)) p.first = "t" + i; return p; }
var keys = {};
for (var i = 0; i < 300; i++) { var p = fill(i), k = Object.keys(p).join(); keys[k] = (keys[k] || 0) + (p.third === p ? 1 : 1000); }
log.push(JSON.stringify(keys), effects);
for (var l = 0; l < log.length; l++) console.log(String(log[l]));
