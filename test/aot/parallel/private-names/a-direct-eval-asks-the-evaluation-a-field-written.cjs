const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { const make = x => class { #f = x; put(o, v) { return eval("o.#f = v, o.#f"); } get(o) { return o.#f; } }; const A = make(k), B = make(k + 1), a = new A(), b = new B(); say(() => a.put(a, k + 5)); say(() => a.put(b, 9)); say(() => a.get(a)); say(() => b.get(b)); say(() => b.put(b, "text" + k)); say(() => b.get(b)); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
