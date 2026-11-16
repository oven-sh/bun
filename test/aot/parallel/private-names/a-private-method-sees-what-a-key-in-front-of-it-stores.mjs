const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { let seen = "none", count = 0; class C { [(seen = "key" + k, count++, "a")]() { return seen; } #p() { return seen + count; } get #g() { return count; } static #s() { return seen; } [(count++, "b")]() { return this.#p() + this.#g; } static c() { return C.#s(); } } const it = new C(); say(() => it.a()); say(() => it.b()); say(() => C.c()); seen = "late"; say(() => it.b()); }
const n = +(process.argv[2] || 60); for (let k = 0; k < n; k++) at(k);
console.log("SAID", out.length, out.slice(0, 4).join("|"), out.every((s, i) => s === ["key" + (i >> 2), "key" + (i >> 2) + "22", "key" + (i >> 2), "late22"][i & 3]));
