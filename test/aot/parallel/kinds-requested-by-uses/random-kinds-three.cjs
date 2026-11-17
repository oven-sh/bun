const seen = [];
class Box { constructor(n) { this.length = n; this.items = [n]; } forEach(f) { f(this.length); } }
class Sized { constructor(a) { this.a = a; this.length = a.length; this[0] = a[0]; } *[Symbol.iterator]() { yield* this.a; } }
class List extends Array {}
const show = (v) => typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : typeof v + ':' + String(v);
const tell = (f) => { try { console.log(show(f()), seen.length); } catch (e) { console.log(e.constructor.name, e.message.replace(/^.*?(is not|undefined|null|Cannot|cannot).*$/s, '$1'), seen.length); } };
function work(d) { let s = 0; d.forEach((r) => { s += r.length; }); return s; }
function work2(d) { let s = 0; for (let i = 0; i < d.length; i++) { s += d[i][d[i].length - 1] * 2; } return s; }
const v0 = [1, 2, 3, 4];
const v1 = ['ab', [1, 2], { a: 1, b: 2 }, 3, undefined];
for (const v of [v0, v0, v0, v1, v1, v0, v0, v0, v1, v0, v1, v0, v0, v1]) tell(() => work(v));
for (let t = 0; t < 3; t++) tell(() => work(v0));
