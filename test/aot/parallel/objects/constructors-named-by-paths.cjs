// Constructor functions that only a path names: new ns.Vector(..), methods through an alias, fields that a method stores.
var log = [], late;
var lib = {}, math = {}, frozen = {}, twice = {}, replaced = {};
(function () { function V(x, y) { this.V(x, y); } lib.V = V; lib.math = math; function W(i) { if (!(this instanceof W)) return new W(i); this.set(i); } lib.math.W = W; })();
(function () { var V = lib.V; V.prototype.V = function (x, y) { this.x = x; this.y = y; }; V.prototype.dot = function (o) { return this.x * o.x + this.y * o.y; }; })();
lib.math.W.prototype.set = function (i) { this.x = i; this.y = "t"; };
lib.math.W.prototype.sum = function () { return this.x + this.y; };
const held = { F: function (i) { this.setup(i); if (i === 5) return { x: 50, y: 1, setup: null }; }, other: 1 };
const P = held.F; P.prototype.setup = function (i) { this.x = i; this.y = i * 0.5; };
frozen.F = function (i) { this.init.apply(this, arguments); }; Object.freeze(frozen);
Object.defineProperty(frozen.F.prototype, "y", { get: function () { return this.x + 1; }, set: function (v) { this.w = v; } });
frozen.F.prototype.init = function (i) { this.x = i; this.y = arguments.length; };
twice.F = function (i) { this.no = 1; }; twice.F = function (i) { this.setup && this.setup(i); };
late = function () { twice.F.prototype.setup = function (i) { this.x = i; this.y = 4; }; };
replaced.F = function G(i) { this.setup(i); G.count = (G.count || 0) + 1; }; const A = replaced.F; A.prototype = { setup: function (i) { this.x = i; this.y = A.count || 0; }, constructor: A };
function show(o) { return Object.keys(o).map(function (k) { return k + "=" + String(o[k]); }).join() + "|" + String(o.y); }
var all = { v: [], w: [], f: [], z: [], t: [], g: [] };
for (var i = 0; i < 30; i++) {
  all.v.push(new lib.V(i * 0.5, 1.5)); all.w.push(i & 1 ? new lib.math.W(i) : lib.math.W(i)); all.f.push(new held.F(i)); all.z.push(new frozen.F(i)); all.t.push(new twice.F(i)); all.g.push(new replaced.F(i));
  if (i === 12) late();
  if (i === 20) replaced.F = function (i) { this.x = "other"; };
}
function dots(list) { var s = 0; for (var i = 0; i < 300; i++) s += list[i % list.length].dot(list[(i + 1) % list.length]); return s; }
function total(list) { var s = 0; for (var i = 0; i < 300; i++) { var o = list[i % list.length]; s = (s + o.x + (+o.y || 0)) | 0; } return s; }
log.push(dots(all.v), total(all.v), total(all.f), total(all.z), total(all.t), total(all.g.slice(0, 20)));
for (var k in all) log.push(k + " " + all[k].slice(3, 23).map(show).join(";"), all[k][1].constructor === lib.V, all[k][1] instanceof held.F, all[k][1] instanceof replaced.F, all[k][1] instanceof A);
delete all.v[3].y; all.v[4].x = "text"; lib.V.prototype.y = 9; lib.V.prototype.dot = function () { return 1; }; lib.math.W.prototype.sum = function () { return "S" + this.y; };
log.push(dots(all.v), total(all.v), all.w.map(function (o) { return o.sum(); }).join(), show(all.v[3]));
try { lib.V(1, 2); } catch (e) { log.push(e.constructor.name); }
for (var j = 0; j < log.length; j++) console.log(String(log[j]));
