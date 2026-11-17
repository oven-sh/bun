const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } };
const make = x => class { #f = x; #m() { return this.#f + 1; } get #p() { return this.#f; } set #p(v) { this.#f = v; } ask(o) { return eval("o.#f + o.#m() + o.#p"); } put(o, v) { return eval("o.#f = v, o.#p += 1, o.#f"); } has(o) { return eval("#f in o") + "," + eval("#m in o"); } own(o) { return o.#f; } };
function go(r) { const A = make(r), B2 = make(9), a = new A(), b = new B2(); for (const v of [1, 2.5, "t", null, { q: 1 }, r]) { say(() => a.put(a, v)); say(() => a.own(a)); say(() => a.put(b, v)); say(() => b.own(b)); } }
for (let r = 0; r < 8; r++) go(r);
console.log(out.length, out.join("|"));
