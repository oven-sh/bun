// Lists and copies of literals with getters that are returned at once, by functions that run by themselves and in copies, nested in other getters.
const tell = (v) => JSON.stringify(v);
function values(n) { const o = { get x() { return [n]; }, y: n }; return Object.values(o); }
function entries(n) { const o = { get x() { return [n]; }, y: n }; return Object.entries(o); }
function keys(n) { const o = { get x() { return [n]; }, y: n }; return Object.keys(o); }
function spread(n) { const o = { get x() { return [n]; }, y: n }; return { ...o }; }
function spread2(n) { const o = { get x() { return [n]; }, y: n }; return { z: 1, ...o }; }
function rest(n) { const o = { get x() { return [n]; }, y: n, z: 3 }; const { z, ...rest } = o; return rest; }
function rest2(n) { const { z, ...rest } = { get x() { return { n }; }, y: n, z: 3 }; return rest; }
function assign(n) { const o = { get x() { return [n]; }, y: n }; return Object.assign({}, o); }
function copy(n) { return { ...{ get x() { return { n }; }, y: n } }; }
const arrow = (n) => Object.values({ get x() { return n; }, y: n });
const arrow2 = (n) => ({ ...{ get x() { return n; } } });
function* steps(n) { const o = { get x() { return n; }, y: n }; yield* Object.values(o); return Object.values(o); }
async function later(n) { const o = { get x() { return n; }, y: n }; return Object.values(o); }
function caught(n) { try { const o = { get x() { if (n > 2) throw new Error("x"); return n; }, y: n }; return Object.values(o); } catch (e) { return e.message; } }
const frozen = Object.freeze({ get x() { return [1]; }, y: 2 });
function ofFrozen() { return Object.values(frozen); }
function copyOfFrozen() { return { ...frozen }; }
function restOfFrozen() { const { y, ...rest } = frozen; return rest; }
for (const f of [values, entries, keys, spread, spread2, rest, rest2, assign, copy, arrow, arrow2, caught, ofFrozen, copyOfFrozen, restOfFrozen]) for (const n of [1, 2, 3]) console.log(f.name, tell(f(n)));
for (let n = 1; n < 4; n++) { console.log(tell([...steps(n)])); later(n).then((v) => console.log("later", tell(v))); }
let t = 0; for (let n = 0; n < 300; n++) t += values(n).length + entries(n)[1][1] + spread(n).x.length + rest(n).y + arrow(n)[0] + keys(n).length; console.log(t);
function n1(n) { const o = { get a() { return Object.values({ get x() { return [n]; }, y: n }); } }; return tell(Object.values(o)[0]); }
function n2(n) { const o = { get a() { return Object.values({ get x() { return [n]; }, y: n }); } }; const c = { ...o }; return tell(c.a); }
function n3(n) { const o = { get a() { return Object.values({ get x() { return [n]; }, y: n }); } }; return tell(o.a); }
function n4(n) { const o = { get a() { const l = Object.values({ get x() { return [n]; }, y: n }); return l; } }; return tell(Object.values(o)[0]); }
function n5(n) { const o = { get a() { return { ...{ get x() { return [n]; }, y: n } }; } }; return tell(Object.values(o)[0]); }
function n6(n) { const o = { get a() { const { y, ...rest } = { get x() { return [n]; }, y: n, z: 3 }; return rest; } }; return tell(Object.values(o)[0]); }
function n7(n) { const o = { get a() { const { y, ...rest } = { get x() { return [n]; }, y: n, z: 3 }; return rest; } }; const c = { ...o }; return tell(c.a); }
function n8(n) { const f = () => Object.values({ get x() { return [n]; }, y: n }); return tell(f()); }
function n9(n) { const o = { m() { return Object.values({ get x() { return [n]; }, y: n }); } }; return tell(o.m()); }
function n10(n) { const o = { get a() { return Object.entries({ get x() { return [n]; }, get z() { return n; } }); } }; const c = { ...o, d: 1 }; return tell(c); }
function n11(n) { const o = { get a() { return Object.keys({ get x() { return [n]; }, y: n }); } }; const c = { ...o }; return tell(c.a); }
function n12(n) { const o = { get a() { return Object.values({ x: [n], y: n }); } }; const c = { ...o }; return tell(c.a); }
function n13(n) { const o = { get a() { return { get x() { return [n]; }, y: n }.x; } }; const c = { ...o }; return tell(c.a); }
function n14(n) { const o = { get a() { return Object.values(frozen); } }; const c = { ...o }; return tell(c.a); }
for (const f of [n1, n2, n3, n4, n5, n6, n7, n8, n9, n10, n11, n12, n13, n14]) { let s = ""; for (let k = 0; k < 4; k++) s += f(k); console.log(f.name, s); }
const out = [];
const other = { get a() { return 'oa'; }, b: 2 };
function nested(n) { for (let i = 0; i < n; i++) { const o = { get a() { return Object.values({ get x() { return [i]; }, y: n }); }, b: [i] }; out.push(Object.values(o), o.a, { ...o }, Object.entries(o)); } }
function listed(n) { for (let i = 0; i < n; i++) { const o = { get a() { return Object.entries({ y: n, get x() { return { i }; }, get z() { return [n]; } }); }, b: [i] }; out.push(Object.values(o), o.a, { ...o }); } }
for (const n of [1, 1, 2, 8]) { out.length = 0; nested(n); listed(n); console.log(n, tell(out)); }
console.log(other.a, tell({ ...other }));
