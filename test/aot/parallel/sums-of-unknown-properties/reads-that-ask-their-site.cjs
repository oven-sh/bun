// Loops that store, call and ask for names: each read asks its site, and a read behind a store of the same name takes what was stored.
// STATISTIC: SiteCachedReadsEmittedInline >= 8
// STATISTIC: ReadsForwardedFromStores >= 2
var calls = 0;
function note(v) { calls++; return v; }
function records(make) { var all = JSON.parse("[]"); for (var i = 0; i < 12; i++) all.push(make(i)); return all; }
function update(all) { for (const u of all) { u.age = u.age + 1; if (u.age > 8) u.age = 0; } return all[3].age; }
function flag(all) { var t = 0; for (const u of all) { u.done = u.rank > 4; if (u.done) t++; t += note(u.rank); } return t; }
function count(all) { var t = 0; for (const u of all) { if ("age" in u && !("nope" in u)) t++; if ("above" in u) t += 100; } return t; }
function places(all) { var t = 0; for (var i = 0; i < all.length; i++) t += all[i]?.place?.east ?? 1; return t; }
function swap(all) { for (const u of all) { var a = u.age; u.age = u.rank; u.rank = a; calls += u.age === u.rank ? 1 : 0; } return all[2].age + ":" + all[2].rank; }
function drop(all) { var t = 0; for (const u of all) { if (u.age === 3) delete u.age; t += u.age === undefined ? 10 : u.age; } return t; }
var text = '{"age":AGE,"rank":RANK,"place":{"east":AGE},"title":"t"}', wide = '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"age":AGE,"rank":RANK,"place":{"east":2}}';
function parse(from, i) { return JSON.parse(from.replaceAll("AGE", i % 7).replaceAll("RANK", i)); }
var holder = Object.defineProperty(JSON.parse('{"above":1}'), "age", { get: function () { calls += 10; return 5; }, set: function (v) { calls += 100; } });
var makers = {
  json: function (i) { return parse(text, i); },
  wide: function (i) { return parse(wide, i); },
  turns: function (i) { return parse(i & 1 ? text : wide, i); },
  kinds: function (i) { var o = parse(text, i); o.age = [1, 0.5, "x", true][i & 3]; return o; },
  heirs: function (i) { var o = Object.create(holder); o.rank = i; return o; },
  setters: function (i) { var o = parse(text, i); if (i === 5) Object.defineProperty(o, "age", { get: function () { return calls; }, set: function (v) { calls += 1000; } }); return o; },
  frozen: function (i) { var o = parse(text, i); return i === 4 ? Object.freeze(o) : o; },
  proxies: function (i) { var o = parse(text, i); return i === 6 ? new Proxy(o, { get: function (t, k) { calls++; return t[k]; }, has: function (t, k) { calls++; return k in t; } }) : o; },
  deleted: function (i) { var o = parse(text, i); if (i % 4 === 0) { delete o.rank; delete o.title; } return o; },
  names: function (i) { var o = parse(text, i); for (var k = 0; k < i * 8; k++) o["k" + k] = k; for (var k = 0; k < i * 8; k++) delete o["k" + k]; return o; },
  lists: function (i) { return i % 3 ? parse(text, i) : Object.assign([1, 2], parse(wide, i)); },
  values: function (i) { return i === 7 ? "text" : i === 8 ? 5 : i === 9 ? true : parse(text, i); },
  missing: function (i) { return i === 10 ? null : parse(text, i); },
};
for (var name in makers) {
  var all = records(makers[name]), out = [];
  for (var round = 0; round < 12; round++) {
    for (var f of [update, flag, count, places, swap, drop]) { try { out.push(f(all)); } catch (e) { out.push(e.constructor.name); } }
    if (round === 5) { all[1] = parse(wide, 2); all[2].age = "s"; all[0].extra = 1; }
    if (round === 8) for (var o of all) if (o && typeof o === "object" && !Object.isFrozen(o)) o.late = round;
  }
  console.log(name, calls, out.join(" "));
}
