const lines = [];
function show(v, d = 0) { return d > 3 ? 'deep' : v === undefined ? 'u' : Object.is(v, -0) ? '-0' : typeof v === 'string' ? (/function|class |=>/.test(v) ? 'src' : JSON.stringify(v)) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? '[' + Array.from(v, x => show(x, d + 1)).join() + ']' : typeof v === 'function' ? 'fn' : v instanceof Map ? 'M' + show([...v], d + 1) : v instanceof Set ? 'S' + show([...v], d + 1) : ArrayBuffer.isView(v) ? 'V' + v.byteLength : v instanceof Error ? v.name + ':' + v.message : v instanceof Date ? 'D' + v.getTime() : v instanceof RegExp ? String(v) : v && typeof v === 'object' ? (v.constructor ? v.constructor.name : 'null') + '{' + Object.keys(v).map(k => k + ':' + show(v[k], d + 1)).join() + '}' : String(v); }
function log(n, v) { lines.push(n + ' ' + show(v)); }
function attempt(n, f) { try { log(n, f()); } catch (e) { log(n, 'threw ' + (e instanceof Error ? e.constructor.name : show(e))); } }
let acc; const box = { k: undefined }; const list0 = []; const table = new Map(); const KEY = { k: 0 }; const x = process.argv.length;
class P { constructor(k) { this.k = k; } met(q) { return [this.k, q]; } }
class Q extends P { constructor(k, m = 'qm') { super(k); this.m = m; } met(q) { return super.met(q).length + show(this.m); } }
class R { constructor() { this.k = 'rk'; } get m() { return this.k; } met() { return this; } }
function* gen(g) { yield g; return g; }
function* gen2() { yield acc; yield 'g2'; }
function hand(h) { let i = 0; return { next() { return i++ < 2 ? { value: i > 1 ? h : { k: i }, done: false } : { value: undefined, done: true }; }, [Symbol.iterator]() { return this; } }; }
function wrap(...q) { return q[0]; }
function wrap2(v, d) { return [v, acc, d - 1]; }
function structured(v) { return { a: { b: v } }.a.b; }
export function setAcc(v) { acc = v; return v; }
export { lines, show, log, attempt, acc, box, list0, table, KEY, x, P, Q, R, gen, gen2, hand, wrap, wrap2, structured };
