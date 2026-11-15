const seen = [];
class Box { constructor(n) { this.length = n; this.items = [n]; } forEach(f) { f(this.length); } }
class Sized { constructor(a) { this.a = a; this.length = a.length; this[0] = a[0]; } *[Symbol.iterator]() { yield* this.a; } }
class List extends Array {}
const show = (v) => typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : typeof v + ':' + String(v);
const tell = (f) => { try { console.log(show(f()), seen.length); } catch (e) { console.log(e.constructor.name, e.message.replace(/^.*?(is not|undefined|null|Cannot|cannot).*$/s, '$1'), seen.length); } };
const make = (z) => (d) => { let s = 0; const n = d.length; for (let i = 0; i < n; i += 1) { const r = d[i]; s += r[0] / r[1]; s += r.length; } return s; };
const work = make(1);
const v0 = [[1, 'x'], ['2', 3]];
const v1 = new List(1, 2, 3);
tell(() => work(v0));
tell(() => work(v0));
tell(() => work(v0));
tell(() => work(v1));
tell(() => work(v1));
tell(() => work(v0));
tell(() => work(v0));
tell(() => work(v0));
tell(() => work(v1));
tell(() => work(v0));
tell(() => work(v0));
tell(() => work(v0));
tell(() => work(v0));
tell(() => work(v1));
for (let t = 0; t < 3; t++) tell(() => work(v0));
