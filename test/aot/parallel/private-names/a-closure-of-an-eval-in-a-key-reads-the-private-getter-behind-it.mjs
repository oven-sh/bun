const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
let late;
function at(k) { class C { [eval("(late = o => o.#p, 'k')")]() { return k; } get #p() { return "G" + k; } } const it = new C(); say(() => late(it)); say(() => late({})); say(() => it.k()); }
const n = +(process.argv[2] || 60); for (let k = 0; k < n; k++) at(k);
console.log("SAID", out.length, out.slice(0, 3).join("|"), out.every((s, i) => s === ["G" + (i / 3 | 0), "TypeError", String(i / 3 | 0)][i % 3]));
