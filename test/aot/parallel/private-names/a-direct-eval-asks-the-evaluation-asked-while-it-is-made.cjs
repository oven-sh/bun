const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { const make = x => class { #a = eval("#b in this"); #b = x; #c = eval("#b in this"); ask() { return [this.#a, this.#c, eval("#b in this")].join(); } }; say(() => new (make(k))().ask()); say(() => new (make(k + 1))().ask()); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
