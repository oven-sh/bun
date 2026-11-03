// A function made from text hands ten arguments on in a tail call.
const end = process.argv.length > 99 ? "x" : ";";
function ten(a, b, c, d, e, f, g, h, i, j) { return [a, b, c, d, e, f, g, h, i, j].join(); }
globalThis.ten = ten;
const tail = new Function("'use strict'; return ten(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)" + end);
const spreadTail = new Function("'use strict'; return ten(...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10])" + end);
const dirty = new Function("...all", "return all.length" + end);
const numbers = Array.from({ length: 100000 }, (_, at) => at);
const objects = Array.from({ length: 100000 }, (_, at) => ({ at }));
const ways = {
  proxy: f => new Proxy(f, {})(),
  bound: f => f.bind(null)(),
  replace: f => "a".replace(/a/, f),
  toString: f => String({ toString: f }),
  reviver: f => JSON.parse("1", f),
  getter: f => Reflect.get(Object.defineProperty({}, "x", { get: f }), "x"),
  sort: f => { let answer; [2, 1].sort(() => { answer = f(); return 0; }); return answer; },
  from: f => Array.from({ length: 1 }, f)[0],
  apply: f => Function.prototype.apply.call(f, null, new Array(5000)),
};
for (const list of [numbers, objects]) {
  for (const f of [tail, spreadTail]) {
    for (const way in ways) {
      let answer;
      dirty(...list);
      try { answer = ways[way](f); } catch (error) { answer = error.constructor.name; }
      if (answer !== "1,2,3,4,5,6,7,8,9,10") console.log(way, f === tail ? "tail" : "spread", list === numbers ? "numbers" : "objects", answer);
    }
  }
}
console.log("done");
