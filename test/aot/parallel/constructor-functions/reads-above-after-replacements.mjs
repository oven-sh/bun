const lines = [];
function show(v, d = 0) { return d > 3 ? 'deep' : v === undefined ? 'u' : Object.is(v, -0) ? '-0' : typeof v === 'string' ? (/function|class |=>/.test(v) ? 'src' : JSON.stringify(v)) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? v.length > 5000 ? 'long' + v.length + Object.keys(v).slice(0, 40) : '[' + Array.from({ length: v.length }, (_, i) => i in v ? show(v[i], d + 1) : 'hole').join() + ']' : typeof v === 'function' ? 'fn' : v instanceof Map ? 'M' + show([...v], d + 1) : v instanceof Set ? 'S' + show([...v], d + 1) : ArrayBuffer.isView(v) ? 'V' + Array.from(v).join('/') : v instanceof Error ? v.name + ':' + v.message : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => k + ':' + show(v[k], d + 1)).join() + '}' : String(v); }
function attempt(n, f) { let r; try { r = show(f()); } catch (e) { } lines.push(n + ' ' + r); }
let n0 = 0, hook = null; const kept = [], proto = { changed: 'P', m() { } }

function G0() { } (G0).prototype.changed = 'G';
function F0(x) { if (n0++ === 0) { (F0).prototype = { changed: x } } }
function make0(x) { const o = new (F0)(x);  return o; }
function f0() { [0, 1, 2].forEach((i) => { const v = make0(make0(1).a); kept.push(v); }); }
attempt('0.0', () => { return [f0(), n0, kept.map((o) => o.changed + Object.keys(o).join(''))]; });

function F3(x) { if (x > 1) { (F3).prototype = { changed: 1 } } this.b = x; }
(F3).prototype = { old: 1, m() { } }
function f3() { let s = '', prev = null; for (let t = 0; t < 2; t++) for (let i = 0; i < 3; i++) { const v = new (F3)(2); s += v.changed + ' '; } return s; }
attempt('3.0', () => { return [f3(), n0, kept.map((o) => o.changed + Object.keys(o).join(''))]; });
console.log(lines.join('\n'));
// 142 runs
