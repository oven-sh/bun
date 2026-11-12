const k = JSON.parse('["a","b","go"]'), T = { a: (x, y) => x - y, b: (x, y) => y - x, go: x => x }, big = Array.from({ length: 40 }, (_, i) => i * 3 % 41);
const l = [3, 1, 2], w = ["c", "a", "b"], d = [0.5, 2.5, 1.5];
for (let t = 0; t < 6; t++) console.log(l.slice().sort(T[k[t & 1]]).join(), w.slice().sort(T[k[5]]).join(), d.slice().sort(T[k[t & 1]]).join(), big.includes(T[k[2]](t * 7)), big.indexOf(T[k[2]](12)), d.includes(T[k[2]](2.5)), w.indexOf(T[k[2]]("b" + (t < 9 ? "" : t))), l.slice(T[k[2]](0.9), T[k[2]](2.1)).join(), [1, , 2].includes(T[k[2]](undefined)), [1n, 2].includes(T[k[2]](1n)));
const m = [5, 4]; console.log(m.sort(((m.sort = null), T.a)).join(), typeof m.sort); const s = []; try { [].sort((s.push(1), 5)); } catch (e) { console.log(e.name, s.length); }
console.log([1, 2].concat().sort(T[k[0]] && undefined).join(), Array.prototype.sort === l.sort);
const rows = []; for (let i = 0; i < 60; i++) rows.push({ id: i, rank: (i * 37) % 61, name: "n" + (i * 7919) % 101 });
const by = { rank: (a, b) => a.rank - b.rank, name: (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id), back: (a, b) => b.id - a.id }, names = Object.keys(by);
for (let t = 0; t < 9; t++) { const sorted = rows.slice().sort(by[names[t % 3]]); console.log(sorted[0].id, sorted[t].id, sorted[59].id); }
