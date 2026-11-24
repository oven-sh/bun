const log = [];
const pick = (n, v) => { log.push(n); return v; };
class A { constructor(x, y) { log.push("made" + x + y); } }
const all = JSON.parse("[0,1]").map((n) => [A, undefined][n]);
for (let i = 0; i < all.length; i++) { try { Reflect.construct(pick("t" + i, all[i]), [pick("a" + i, 1), pick("b" + i, 2)]); } catch (e) { log.push(e.constructor.name); } }
console.log(log.join());
