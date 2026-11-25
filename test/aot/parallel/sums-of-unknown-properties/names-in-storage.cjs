// Records with more properties than their cell holds: names read together, all of them in the storage, some of them, and none.
// STATISTIC: SiteCachedReadGroupsEmitted >= 3
function records(make) { var all = JSON.parse("[]"); for (var i = 0; i < 16; i++) all.push(make(i)); return all; }
function sum(all, k) { var s = 0; for (var i = 0; i < k; i++) { var o = all[i & 15]; s = (s + o.x + o.y) | 0; } return s; }
function first(all, k) { var s = 0; for (var i = 0; i < k; i++) { var u = all[i & 15]; if (u.on) s += u.id; } return s; }
function mixed(all, k) { var t = 0; for (var i = 0; i < k; i++) { var u = all[i & 15]; t += u.id * 2 + u.y; } return t; }
function names(all, k) { var t = ""; for (var i = 0; i < k; i++) { var u = all[i & 15]; t += u.last + u.id; } return t.length + t.slice(-12); }
var wide = '{"id":ID,"a":1,"b":2,"c":3,"d":4,"e":5,"x":ID,"y":2,"on":true,"last":"l"}', less = '{"id":ID,"a":1,"b":2,"x":ID,"y":2,"on":false,"last":"k"}';
var parse = function (text, i) { return JSON.parse(text.replaceAll("ID", i)); };
var makers = {
  wide: function (i) { return parse(wide, i); },
  less: function (i) { return parse(less, i); },
  turns: function (i) { return parse(i & 1 ? wide : less, i); },
  many: function (i) { var o = parse(i % 3 ? wide : less, i); for (var k = 0; k < i % 5; k++) o["more" + k] = k; return o; },
  later: function (i) { var o = parse(less, i); for (var k = 0; k < 40; k++) o["n" + k] = k; o.z = 1; return o; },
  doubles: function (i) { var o = parse(wide, i); o.y = i + 0.5; return o; },
  texts: function (i) { var o = parse(wide, i); o.x = "t" + i; return o; },
  elements: function (i) { var o = parse(wide, i); for (var k = 0; k < 9; k++) o[k] = k; return o; },
  lists: function (i) { return Object.assign([1, 2, 3], parse(wide, i)); },
  deleted: function (i) { var o = parse(wide, i); if (i % 3 === 0) { delete o.b; delete o.x; o.x = 7; } return o; },
  getters: function (i) { var o = parse(wide, i); if (i === 11) Object.defineProperty(o, "y", { get: function () { return 100; } }); return o; },
  above: function (i) { return i % 4 ? parse(wide, i) : Object.create(parse(wide, i)); },
};
for (var name in makers) {
  var all = records(makers[name]), out = [];
  for (var f of [sum, first, mixed, names]) for (var k of [4, 40, 400]) { try { out.push(f(all, k)); } catch (e) { out.push(e.name); } }
  console.log(name, out.join(" "));
  for (var o of all) { o.added = 1; o.x = 3; } if (name === "turns") all.reverse();
  out = []; for (var f of [sum, first, mixed, names]) for (var k of [3, 100]) { try { out.push(f(all, k)); } catch (e) { out.push(e.name); } }
  console.log(name, out.join(" "));
}
