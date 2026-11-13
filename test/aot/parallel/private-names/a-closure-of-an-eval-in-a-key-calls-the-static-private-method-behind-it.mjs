const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
let late;
function at(k) { class C { static [eval("(late = o => o.#p(), 'k')")]() { return k; } static #p() { return "S" + k; } } const it = C; say(() => late(it)); say(() => late({})); say(() => it.k()); }
const n = +(process.argv[2] || 60); for (let k = 0; k < n; k++) at(k);
console.log("SAID", out.length, out.slice(0, 3).join("|"), out.every((s, i) => s === ["S" + (i / 3 | 0), "TypeError", String(i / 3 | 0)][i % 3]));
