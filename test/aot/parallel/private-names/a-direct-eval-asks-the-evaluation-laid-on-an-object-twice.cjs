const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
class Giver { constructor(o) { return o; } }
function at(k) { const make = x => class extends Giver { #f = x; static ask(o) { return eval("o.#f"); } static add(o, v) { return eval("o.#f += v"); } }; const A = make(k), B = make(k + 7), l = { k }, only = { k: k + 1 }; new A(l); new B(l); new A(only); say(() => A.ask(l)); say(() => B.ask(l)); say(() => A.ask(only)); say(() => B.ask(only)); say(() => A.add(l, 2)); say(() => B.add(l, 3)); say(() => A.ask(l)); say(() => B.ask(l)); say(() => new A(l)); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
