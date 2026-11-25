// Equal elements keep their order in lists of every size and kind.
const z = JSON.parse("[0]")[0], out = [], say = (f) => { try { return String(f()); } catch (e) { return e.name + ":" + e.message; } };
const mk = (n, g) => { const l = []; for (let i = 0; i < n; i++) l.push(g(i)); return l; }, show = (l) => l.length + "[" + Array.from({ length: Math.min(l.length, 40) }, (_, i) => (i in l ? (Object.is(l[i], -0) ? "-0" : typeof l[i] === "object" && l[i] ? l[i].k + "#" + l[i].id : String(l[i])) : "_")).join() + "]";
const table = { up: (a, b) => a - b, down: (a, b) => b - a, k: (a, b) => a.k - b.k, none: () => 0 }, name = (s) => JSON.parse('["' + s + '"]')[0];
const sizes = [2, 7, 11, 12, 13, 24, 63, 64, 65, 130];
for (const n of sizes) { out.push(show(mk(n, (i) => ({ k: i * 7 % 5, id: i })).sort(table[name("k")]))); out.push(show(mk(n, (i) => i * 37 % 101).sort(table[name("up")]))); out.push(show(mk(n, (i) => i * 37 % 101 / 4).sort(table[name("down")]))); out.push(show(mk(n, (i) => (i % 3 ? i * 5 % 7 : "t" + i)).sort((a, b) => (String(a) < String(b) ? -1 : 1)))); out.push(show(mk(n, (i) => (i & 1 ? -0 : 0)).sort(table[name("up")]))); out.push(show([...mk(n, (i) => n - i)].sort(table[name("none")]))); }
console.log(out.join("\n"));
