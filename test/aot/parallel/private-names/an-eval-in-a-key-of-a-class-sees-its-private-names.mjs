const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
class D { #m() { return "D"; } mk(s) { return class C extends (eval(s)) { #n() { return "C"; } n(o) { return o.#n(); } [eval("'k'")]() { return eval("this.#n()"); } }; } }
function at(k) { const C = new D().mk("(class { t(o) { return o.#m(); } })"); say(() => new C().t(new D())); say(() => new C().k()); say(() => new C().n(new C())); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
