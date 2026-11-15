let heard = 0, W = () => 0;
const sum = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i >= 0; i--) s += t[i].id; return s; };
const some = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i >= 0; i--) { if (t[i].score < 10) continue; s += t[i].id; } return s; };
const step = d => { const t = d.users; let s = 0; for (let i = t.length; i--;) s += t[i].id * 2; return s; };
const post = d => { const t = d.users; let s = 0, i = t.length; while (i-- > 0) s += t[i].id - t[i].score; return s; };
const pairs = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i > 0; i--) s += t[i].id - t[i - 1].id + t[i].score; return s; };
const find = (d, id) => { const t = d.users; for (let i = t.length - 1; i >= 0; i--) if (t[i].id === id) return i; return -1; };
const over = d => { const t = d.users; let s = 0; for (let i = t.length; i >= 0; i--) s += t[i]?.id ?? 100; return s; };
const under = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i >= -2; i--) s += t[i] ? t[i].id : 7; return s; };
const halves = d => { const t = d.users; let s = 0; for (let i = t.length / 2; i >= 0; i--) s += t[i]?.id ?? 0.25; return s; };
const acts = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i >= 0; i--) { s += t[i].id; if (i === 3) W(d); } return s; };
const stores = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i >= 0; i--) { t[i].id = t[i].id + i; s += t[i].id; } return s; };
const moves = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i > 0; i--) { t[i] = t[i - 1]; s += t[i].id; } return s; };
const nested = d => { const t = d.users; let s = 0; for (let i = t.length - 1; i >= 0; i--) for (let j = i; j >= 0; j--) s += t[i].id * t[j].score; return s; };
const json = process.argv.length > 99 ? "{}" : '{"users":[' + Array.from({ length: 6 }, (_, i) => `{"id":${i},"score":${i * 4.5}}`).join() + "]}";
const fresh = () => JSON.parse(json);
const change = apply => () => { const d = fresh(); apply(d, d.users); return d; };
const kinds = {
  plain: fresh,
  empty: change(d => { d.users = []; }),
  one: change(d => { d.users.length = 1; }),
  hole: change((d, t) => { delete t[2]; }),
  end: change((d, t) => { delete t[5]; }),
  number: change((d, t) => { t[3] = 7; }),
  numbers: change(d => { d.users = [1, 2, 3]; }),
  doubles: change(d => { d.users = [0.5, 1.5]; }),
  text: change((d, t) => { t[2].id = "two"; }),
  missing: change((d, t) => { delete t[1].id; }),
  nothing: change((d, t) => { t[4] = null; }),
  getter: change((d, t) => Object.defineProperty(t[3], "id", { get: () => ++heard })),
  element: change((d, t) => { const u = t[1]; Object.defineProperty(t, 1, { get: () => (heard++, u), configurable: true }); }),
  longer: change((d, t) => { t.length = 9; }),
  object: change((d, t) => { d.users = { ...t, length: 4 }; }),
  words: change((d, t) => { d.users = { ...t, length: "3" }; }),
  fraction: change((d, t) => { d.users = { ...t, length: 2.5 }; }),
  large: change((d, t) => { d.users = { ...t, length: 3, 2: t[2] }; }),
  string: change(d => { d.users = "abc"; }),
  view: change(d => { d.users = new Float64Array(4); }),
  heir: change((d, t) => { d.users = class extends Array {}.from(t); }),
  proxy: change((d, t) => { d.users = new Proxy(t, { get: (o, k) => (heard++, o[k]) }); }),
  frozen: change((d, t) => { t.forEach(Object.freeze); Object.freeze(t); }),
  bigint: change((d, t) => { t[2].id = 5n; }),
  nan: change((d, t) => { t[0].id = NaN; t[1].score = -0; t[2].score = Infinity; }),
  noUsers: () => ({}),
  nullUsers: () => ({ users: null }),
};
const deeds = {
  none: () => 0, pop: d => d.users.pop?.(), push: d => d.users.push?.({ id: 50, score: 1 }), cut: d => { d.users.length = 1; }, replace: d => { d.users = [{ id: 1000, score: 0 }]; },
  kind: d => { d.users[1] = 0.5; }, accessor: d => Object.defineProperty(d.users, 0, { get: () => ({ id: 70, score: 2 }), configurable: true }), rename: d => { if (d.users[0]) d.users[0].id = "zero"; }, throws: () => { throw new RangeError("w"); }, collect: () => Bun.gc(true),
};
const show = value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : JSON.stringify(value) ?? String(value));
const attempt = run => { try { return show(run()); } catch (error) { return error.constructor.name; } };
for (const name in kinds) {
  for (let round = 0; round < 2; round++) console.log(name, [sum, some, step, post, pairs, over, under, halves, stores, moves, nested].map(run => attempt(() => run(kinds[name]()))).join(" "), attempt(() => find(kinds[name](), 2)), attempt(() => find(kinds[name](), 60)), heard);
  for (const deed in deeds) { W = deeds[deed]; const d = kinds[name](); console.log(name, deed, attempt(() => acts(d)), attempt(() => acts(d)), attempt(() => Array.from(d.users, u => u?.id)), heard); }
}
