const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { let seen = "none"; class C { [(seen = "key" + k, "a")]() { return 1; } #p() { return seen; } get #g() { return seen + "g"; } static #s() { return seen + "s"; } b() { return this.#p() + this.#g; } static c() { return C.#s(); } } const it = new C(); say(() => it.b()); say(() => C.c()); }
const n = +(process.argv[2] || 60); for (let k = 0; k < n; k++) at(k);
console.log("SAID", out.length, out.slice(0, 2).join("|"), out.every((s, i) => s === ["key" + (i >> 1) + "key" + (i >> 1) + "g", "key" + (i >> 1) + "s"][i & 1]));
