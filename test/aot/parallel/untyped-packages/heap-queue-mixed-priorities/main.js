// An untyped package and a program of it (mixed priorities): a binary heap with updates by key
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const h = new lib(); let s = 7; const next = () => (s = s * 1103515245 + 12345 & 0x7fffffff) % 100;
for (let i = 0; i < 60; i++) { const k = i % 2 ? 'k' + next() % 20 : next() % 20; const p = i < 20 ? next() : i < 40 ? next() / 8 : i % 9 === 0 ? NaN : -next(); const r = h.push(k, p, { i }); if (i % 5 === 4) { const t = h.pop(); say(i, r, t.key, t.priority, t.value.i, h.size, h.check()); } if (i % 13 === 12) say('remove', k, h.remove(k), h.remove('none'), h.check()); }
const order = []; while (h.size) order.push(h.pop().key); say(order.join(), h.moves, h.pop());
