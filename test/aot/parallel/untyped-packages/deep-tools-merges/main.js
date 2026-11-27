// An untyped package and a program of it (merges): clone, merge, equality, differences, paths, freezing and mapping over anything
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const base = () => ({ a: { b: [1, { c: 2 }], d: 'x' }, f: null, n: 5 }); const parts = [{ a: { b: [9] } }, { a: { b: [undefined, { c: 3, e: [1] }] } }, { f: { g: 1 } }, { f: undefined, n: 0 }, { a: null }, JSON.parse('{"__proto__":{"bad":1},"ok":1}'), { a: { d: ['l'] } }, null, { a: { b: { 0: 'o' } } }]; for (let i = 0; i < 9; i++) for (let k = i; k < 9; k += 3) { const m = lib.merge(base(), parts[i], parts[k], i > 4 ? parts[0] : undefined); say(i, k, JSON.stringify(m), m.bad, {}.bad); } say(JSON.stringify(parts[1]), JSON.stringify(lib.set({}, 'a[0].b["c d"].2', 1)), lib.get({ a: [{ b: 0 }] }, 'a[0].b', 7), lib.get(null, 'x', 'd'));
