// Object.keys(), entries, spreads and for-in of objects that share an order of keys and have more or fewer of them, deleted, defined, frozen and added on the way.
const list = [{ a: 1 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { c: 3 }, {}, { a: 1, b: 2, c: 3 }, { d: 4, e: 5 }, { a: 9 }, { a: 1, b: 2, c: 3, d: 4 }, { 1: "x", a: 2 }];
class Options { constructor(n) { this.first = n; if (n > 1) this.second = n; if (n > 2) this.third = n; if (n % 2) this.odd = true; } }
const made = Array.from({ length: 12 }, (_, i) => new Options(i % 5));
function grown(n) { const o = { start: 0 }; for (let i = 0; i < n; i++) o["p" + i] = i; return o; }
for (let i = 0; i < 12; i++) made.push(grown(i));
function keys(l, turns) { let s = ""; for (let k = 0; k < turns; k++) { const q = Object.keys(l[k % l.length]); if (k < 60) s += q.join("") + ","; else s = s.slice(q.length); } return s; }
function counts(l, turns) { let n = 0; for (let k = 0; k < turns; k++) n = n * 3 + Object.keys(l[k % l.length]).length & 0xffffff; return n; }
function others(l) { const out = []; for (const o of l) { let s = ""; for (const q in o) s += q; out.push(s, Object.entries(o).length, Object.getOwnPropertyNames(o).join(), Reflect.ownKeys(o).length, Object.keys({ ...o, z: 1 }).join(), Object.keys({ ...o, ...l[1] }).join(), JSON.stringify(o)); } return out.join(" "); }
for (const l of [list, made, [...list, ...made]]) console.log(keys(l, 200), counts(l, 1000), others(l));
delete list[5].b; list[0].zz = 1; Object.defineProperty(list[1], "hidden", { value: 1, enumerable: false }); Object.freeze(list[2]); list[4][Symbol("s")] = 1; list[7].a = undefined; delete made[4].first; made[3].late = 1;
for (const l of [list, made]) console.log(keys(l, 200), counts(l, 1000), others(l));
