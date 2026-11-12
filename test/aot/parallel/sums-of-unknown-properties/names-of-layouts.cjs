// Records read together in loops although layouts of the file have the same names, and instances of those layouts beside them.
// STATISTIC: SiteCachedReadGroupsEmitted >= 3
const defaults = { id: 0, name: "", score: 0, x: 0, y: 0 };
function pair(x, y) { return { x: x, y: y, z: 0 }; }
class Vector { constructor(x, y) { this.x = x * 0.5; this.y = y * 0.25; } length() { return this.x * this.x + this.y * this.y; } }
class User { constructor(id, name, score) { this.id = id; this.name = name; this.score = score; } }
var length = 0; for (var i = 0; i < 20; i++) length += new Vector(i, i + 1).length() + pair(i, 2).x;
console.log(length, Object.keys(defaults).join(), new User(1, "a", 2).score);
function records(make) { var all = JSON.parse("[]"); for (var i = 0; i < 16; i++) all.push(make(i)); return all; }
function sum(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + o.x + o.y) | 0; } return s; }
function scores(all, k) { var s = 0; for (var i = 0; i < k; i++) { var u = all[i & 15]; if (u.id > 3) s += u.score; } return s; }
function names(all, k) { var t = ""; for (var i = 0; i < k; i++) { var u = all[i & 15]; t += u.name + u.id; } return t.length + t.slice(-12); }
function three(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s += o.x; s += o.y; s += o.z; } return s; }
var makers = {
  json: function (i) { return JSON.parse('{"id":' + i + ',"name":"n","score":' + i + ',"x":' + i + ',"y":1,"z":2}'); },
  orders: function (i) { return JSON.parse(i & 1 ? '{"x":' + i + ',"y":1,"z":2,"id":1,"name":"m","score":3}' : '{"score":4,"z":2,"y":1,"x":' + i + ',"name":"l","id":5}'); },
  literals: function (i) { return pair(i, 1); }, vectors: function (i) { return new Vector(i, 2); }, users: function (i) { return new User(i, "u", i * 2); },
  kinds: function (i) { return [pair(i, 1), new Vector(i, 2), new User(i, "k", 1), JSON.parse('{"x":' + i + ',"y":0.5,"id":' + i + ',"score":1}')][i & 3]; },
  some: function (i) { return i % 5 ? JSON.parse('{"x":' + i + ',"y":"1","id":7,"score":2,"name":"s"}') : JSON.parse("{}"); },
  primitives: function (i) { return i === 9 ? "text" : i === 10 ? 5 : JSON.parse('{"x":1,"y":2,"z":3,"id":4,"score":5,"name":"p"}'); },
};
for (var name in makers) {
  var all = records(makers[name]), out = [];
  for (var f of [sum, scores, names, three]) for (var k of [4, 40, 400]) { try { out.push(f(all, k)); } catch (e) { out.push(e.name); } }
  console.log(name, out.join(" "));
  all[3] = null; out = []; for (var f of [sum, scores, names, three]) for (var k of [3, 40]) { try { out.push(f(all, k)); } catch (e) { out.push(e.name); } }
  console.log(name, out.join(" "));
}
