const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } };
const make = x => class { #f = x; #m() { return this.#f + 1; } get #p() { return this.#f; } set #p(v) { this.#f = v; } ask(o) { return eval("o.#f + o.#m() + o.#p"); } put(o, v) { return eval("o.#f = v, o.#p += 1, o.#f"); } has(o) { return eval("#f in o") + "," + eval("#m in o"); } own(o) { return o.#f; } };
class R { z = 1; }
function go(r) { const A = make(r), a = new A(); for (const o of [Reflect.construct(A, [], R), Reflect.construct(A, [], Object), Reflect.construct(A, [], Array), Reflect.construct(A, [], function () {})]) { say(() => a.ask(o)); say(() => a.has(o)); say(() => a.put(o, r)); say(() => a.own(o)); } }
for (let r = 0; r < 8; r++) go(r);
console.log(out.length, out.join("|"));
