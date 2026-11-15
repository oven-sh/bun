const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { const make = x => class { v = x; get #p() { return this.v; } set #p(y) { this.v = y; } ask(o) { return eval("o.#p++, o.#p"); } }; const A = make(k), B = make(k + 1), a = new A(), b = new B(); say(() => a.ask(b)); say(() => a.ask(new A())); say(() => b.ask(b)); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
