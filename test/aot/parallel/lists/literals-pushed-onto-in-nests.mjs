const lines = [];
function show(v, d = 0) { return d > 3 ? 'deep' : v === undefined ? 'u' : Object.is(v, -0) ? '-0' : typeof v === 'string' ? (/function|class |=>/.test(v) ? 'src' : JSON.stringify(v)) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? v.length > 5000 ? 'long' + v.length + Object.keys(v).slice(0, 40) : '[' + Array.from({ length: v.length }, (_, i) => i in v ? show(v[i], d + 1) : 'hole').join() + ']' : typeof v === 'function' ? 'fn' : v instanceof Map ? 'M' + show([...v], d + 1) : v instanceof Set ? 'S' + show([...v], d + 1) : ArrayBuffer.isView(v) ? 'V' + Array.from(v).join('/') : v instanceof Error ? v.name + ':' + v.message : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => k + ':' + show(v[k], d + 1)).join() + '}' : String(v); }
function log(n, v) { lines.push(n + ' ' + show(v)); }
function attempt(n, f) { let r; try { r = show(f()); } catch (e) { r = 'threw ' + (e instanceof Error ? e.constructor.name : show(e)); } lines.push(n + ' ' + r); }
let last = []; const q0 = [], f64 = new Float64Array([0.5, 1]);
const H0 = { l: ['h'], v: 1 }; const M0 = [0.5, 1.5];
function f0(xs, ys) { let s = 0; const a = [1, 2, 3]; const out = []; for (let t = 0; t < 3; t++) { const b = [true]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; b.push(xs[i]); a.push(x + ys[i]); b.push(x, i); } out.push([b]); } last = H0.l; return [s, out, a]; }
attempt('0.0', () => { q0.length = 0;  let z; try { z = f0([-0, NaN], [null, 1]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M0]; });
attempt('0.1', () => { q0.length = 0; H0.v = 0.5; let z; try { z = f0([1, 'x', 2], [5, 4, 3, 2, 1, 0]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M0]; });
const H1 = { l: [], v: 1 }; const M1 = [4, 5];
function f1(xs, ys) { let s = 0; const c = [0, 0, 0, 0]; const out = []; for (let t = 0; t < 2; t++) { const a = [true]; const b = [2147483647]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; b.push(M1[i]); c.push(H1.l[i & 1]); a.push(x / 2); s += b.length; } out.push([a, b]); } last = M1; return [s, out, c]; }
attempt('1.0', () => { q0.length = 0;  let z; try { z = f1([5, 4, 3, 2, 1, 0], ['p', 'q', 'r']); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M1]; });
attempt('1.1', () => { q0.length = 0; M1.push(2.5); let z; try { z = f1([1], []); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M1]; });
const H2 = { l: [1, 2], v: 1 }; const M2 = [4, 5];
function f2(xs, ys) { let s = 0; const a = [-0]; const b = [-0]; const out = []; for (let t = 0; t < 3; t++) {  for (let i = 0; i < xs.length; i++) { const x = xs[i]; b.push(M2[i]); a.push(xs[i + 1]); } out.push([]); }  return [s, out, a, b]; }
attempt('2.0', () => { q0.length = 0;  let z; try { z = f2([undefined, 2], [{ v: 1 }]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M2]; });
attempt('2.1', () => { q0.length = 0; M2[1] = 'z'; let z; try { z = f2(['p', 'q', 'r'], ['p', 'q', 'r']); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M2]; });
const H3 = { l: ['h'], v: 'v' }; const M3 = [0.5, 1.5];
function f3(xs, ys) { let s = 0; const a = [1, 'b']; const b = [[]]; const out = []; for (let t = 0; t < 2; t++) {  let i = 0; for (const x of xs) { a.push(xs[i - 1]); q0.push(i); b.push(ys.length); i++; } out.push([]); } last = xs; return [s, out, a, b]; }
attempt('3.0', () => { q0.length = 0;  let z; try { z = f3([null, 1], [1, 'x', 2]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M3]; });
attempt('3.1', () => { q0.length = 0; last = []; let z; try { z = f3(['p', 'q', 'r'], [2147483647, 2147483648]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M3]; });
attempt('3.2', () => { q0.length = 0; last.push(1); let z; try { z = f3([1, , 3], [null, 1]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M3]; });
const H4 = { l: ['h'], v: 0.5 }; const M4 = [];
function f4(xs, ys) { let s = 0;  const out = []; for (let t = 0; t < 2; t++) { const a = [1, 2, 3]; const b = [0.5]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a.push(H4.l[i & 1]); b.push(x > 2 ? x : 's'); } out.push([a, b]); } last = a; return [s, out, 0]; }
attempt('4.0', () => { q0.length = 0;  let z; try { z = f4([-0, NaN], []); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M4]; });
attempt('4.1', () => { q0.length = 0; last = []; let z; try { z = f4(['p', 'q', 'r'], [1, 2, 3]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M4]; });
attempt('4.2', () => { q0.length = 0; last.push(1); let z; try { z = f4([1, 2, 3], [1]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M4]; });
attempt('4.3', () => { q0.length = 0; H4.l.push('t'); let z; try { z = f4([2147483647, 2147483648], [null, 1]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M4]; });
const H5 = { l: [1, 2, 3, 4, 5], v: 'v' }; const M5 = ['m', 1];
function f5(xs, ys) { let s = 0; const b = [1, 2, 3]; const out = []; for (let t = 0; t < 2; t++) { const a = [0, 0, 0, 0]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; b.push(ys[i + 2]); a.push(xs[i - 1]); } out.push([a]); } last = a; return [s, out, b]; }
attempt('5.0', () => { q0.length = 0;  let z; try { z = f5([0.5, 1.5], ['p', 'q', 'r']); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M5]; });
attempt('5.1', () => { q0.length = 0;  let z; try { z = f5([0.5, 1.5], []); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M5]; });
attempt('5.2', () => { q0.length = 0;  let z; try { z = f5([-0, NaN], [-0, NaN]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M5]; });
attempt('5.3', () => { q0.length = 0; last = []; let z; try { z = f5([], [null, 1]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M5]; });
const H6 = { l: [0.5], v: 'v' }; const M6 = ['m', 1];
function f6(xs, ys) { let s = 0; const a = [, 1]; const b = [0]; for (let i = 0; i < xs.length; i++) { const x = xs[i]; a.push(s); b.push(H6.v); } last = xs; return [s, a, b]; }
attempt('6.0', () => { q0.length = 0;  let z; try { z = f6([undefined, 2], [-0, NaN]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M6]; });
attempt('6.1', () => { q0.length = 0; H6.l = []; let z; try { z = f6([1, 2, 3], [1, 2, 3, 0.5]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M6]; });
const H7 = { l: ['h'], v: 0.5 }; const M7 = [4, 5];
function f7(xs, ys) { let s = 0; const a = [[]]; const out = []; for (let t = 0; t < 2; t++) { const b = []; for (let i = 0; i < 4; i++) { const x = xs[i]; if (x === 3) continue; a.push(ys[i + 2]); b.push(i); } out.push([b]); } last = ys; return [s, out, a]; }
attempt('7.0', () => { q0.length = 0;  let z; try { z = f7([1, 2, 3], [2147483647, 2147483648]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M7]; });
attempt('7.1', () => { q0.length = 0; H7.l = [-0, NaN]; let z; try { z = f7([undefined, 2], [undefined, 2]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M7]; });
attempt('7.2', () => { q0.length = 0; H7.v = 0.5; let z; try { z = f7([undefined, 2], [null, 1]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M7]; });
attempt('7.3', () => { q0.length = 0;  let z; try { z = f7([0.5, 1.5], [1, 2, 3]); } catch (e) { z = 'T' + e.constructor.name; } return [z, q0.slice(), M7]; });

console.log(lines.join('\n'));
export {};
