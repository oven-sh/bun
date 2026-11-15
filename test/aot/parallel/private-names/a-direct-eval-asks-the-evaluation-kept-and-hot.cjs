const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { const make = x => class { #f = x; #m() { return 1; } get() { return eval("o => #m in o ? o.#f : -1"); } }; const A = make(k), B = make(k + 1), f = new A().get(), own = new A(), other = new B(); let s = 0; for (let i = 0; i < 3000; i++) s += f(i & 1 ? own : other); say(() => s); say(() => f(other)); }
const n = +(process.argv[2] || 8); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
