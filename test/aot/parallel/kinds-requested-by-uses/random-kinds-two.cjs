const seen = [];
class Box { constructor(n) { this.length = n; this.items = [n]; } forEach(f) { f(this.length); } }
class Sized { constructor(a) { this.a = a; this.length = a.length; this[0] = a[0]; } *[Symbol.iterator]() { yield* this.a; } }
class List extends Array {}
const show = (v) => typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : typeof v + ':' + String(v);
const tell = (f) => { try { console.log(show(f()), seen.length); } catch (e) { console.log(e.constructor.name, e.message.replace(/^.*?(is not|undefined|null|Cannot|cannot).*$/s, '$1'), seen.length); } };
const all = [[[1, 'x'], ['2', 3]], [1.5, -0, NaN], () => 1];
let d;
for (const k of [0, 2, 1, 0, 0, 0, 0, 0, 2, 2, 0, 2, 0, 2]) { d = all[k]; let s = 0; try { const n = d.length; for (let i = 0; i < n; i += 1) { const r = d[i]; s += r[0] * r[1]; } console.log(show(s), seen.length); } catch (e) { console.log(e.constructor.name, seen.length); } }
