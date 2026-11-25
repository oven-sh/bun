// A name is added and deleted in turn: the object's structures lead to a dictionary that stays one, as in plain.
function records(text) { var all = []; for (var i = 0; i < 16; i++) all.push(JSON.parse(text.replaceAll("N", i))); return all; }
var texts = ['{"id":N,"x":N,"y":2}', '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"id":N}', '{"id":N}', '{"0":1,"id":N,"list":[1]}'];
function marks(all) { var t = 0; for (const p of all) { p.mark = t; if (p.id % 3) delete p.mark; t += "mark" in p ? 2 : 1; } return t; }
function first(all) { for (const p of all) { var v = p.id; delete p.id; p.id = v + 1; } return all[5].id; }
function both(all) { for (const p of all) { p.one = 1; p.two = p.id; delete p.one; p.three = p.two; delete p.two; } return all[7].three; }
function keyed(all) { var t = 0; for (const p of all) { var k = "k" + (p.id % 5); p[k] = k; t += Object.keys(p).length; delete p[k]; } return t; }
for (var text of texts) {
  var all = records(text), out = [];
  for (var round = 0; round < 60; round++) for (var f of [marks, first, both, keyed]) { var t = f(all); if (round % 20 === 0) out.push(t); }
  console.log(out.join(), all.map(function (p) { return Object.keys(p).join("."); }).join(" "));
  all = records(text); Object.freeze(all[3]); Object.preventExtensions(all[4]); Object.defineProperty(all[5], "mark", { get: function () { return 1; }, configurable: true });
  for (var round = 0; round < 40; round++) { marks(all); both(all); }
  console.log(JSON.stringify(all));
}
