// An untyped package and a program of it (turns): classes over Map, Array, Set and Error
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const d = new lib.DefaultMap(k => typeof k === 'number' ? k * 10 : 0, [['a', 5]]); const s = new lib.Stack(), l = new lib.Lru(3), b = new lib.Bag();
for (let i = 0; i < 24; i++) { const k = ['a', 'b', i % 5, 'B', null][i % 5]; say(i, d.increment(k, i % 3 ? 1 : 0.5), d.misses, d.size, s.push(i, i * i), s.top, s.sum(), s.length, l.set(k, i).get('a'), [...l.keys()].map(String).join(), b.add(k).add('X' + i % 4).size); if (i % 6 === 5) { say(s.slice(1, 4).constructor.name, s.map(x => x * 2).join(), s.splice(0, 5).join(), s instanceof Array, Array.isArray(s), JSON.stringify(d), [...b.union2(['Q', 1])].join(), b.union2([]).constructor.name, b.adds); } }
try { s.push(undefined); } catch (e) { say(e.name, e.message, s.length); } s.length = 1; say(s.top, s.sum());
