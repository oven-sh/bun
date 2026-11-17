const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
class D { #m() { return "D"; } mk() { return class C extends (eval("(class { static t(o) { return o.#m(); } })")) { #m() { return "C"; } own(o) { return o.#m(); } }; } }
function at(k) { const C = new D().mk(); say(() => C.t(new D())); say(() => C.t(new C())); say(() => new C().own(new C())); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
