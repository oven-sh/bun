// @ts-nocheck
const lines: any = [];
function show(v: any, d: number = 0): string { return d > 3 ? 'deep' : v === undefined ? 'u' : Object.is(v, -0) ? '-0' : typeof v === 'string' ? (/function|class |=>/.test(v) ? 'src' : JSON.stringify(v)) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? v.length > 5000 ? 'long' + v.length + Object.keys(v).slice(0, 40) : '[' + Array.from({ length: v.length }, (_: any, i: number) => i in v ? show(v[i], d + 1) : 'hole').join() + ']' : typeof v === 'function' ? 'fn' : v instanceof Map ? 'M' + show([...v], d + 1) : v instanceof Set ? 'S' + show([...v], d + 1) : ArrayBuffer.isView(v) ? 'V' + Array.from(v as any).join('/') : v instanceof Error ? v.name + ':' + v.message : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => k + ':' + show(v[k], d + 1)).join() + '}' : String(v); }
function log(n: any, v: any) { lines.push(n + ' ' + show(v)); }
function attempt(n: any, f: any) { let r: any; try { r = show(f()); } catch (e: any) { r = 'threw ' + (e instanceof Error ? e.constructor.name : show(e)); } lines.push(n + ' ' + r); }
let n0: any = 0; function proto(l: any): any { return Object.setPrototypeOf(l, Object.create(Array.prototype, { 1: { value: 40, writable: true }, 3: { get() { n0++; return 2; }, set(v: any) { n0 += 10; } } })); }
function snap(w: any): any { if (!w || typeof w !== 'object') return w; const o: any = []; for (let j = 0; j < w.length && j < 12; j++) o.push(j in w ? (typeof w[j] === 'object' && w[j] ? 'ob' : Object.is(w[j], -0) ? '-0' : String(w[j])) : 'h'); return o.join() + '/' + w.length; }
function f8(a: any, b: any, c: any, d: any, n: any, x: any): any { let s: any = 0, t: any = 0; const j = 1, out: any = []; try { for (let i = n - 1; i >= 0; i--) { if (a[i] < 0) { a[i] = x; } else { a[i] = x; } s += a[i + 1]; s += d[i] * a[i]; } } catch (e: any) { out.push(e.constructor.name); } return [s, t, out.slice(0, 12), snap(a), snap(b), snap(c), snap(d), n0]; }
attempt('8.0', () => { n0 = 0; const a: any = [1, , 3, 4, , 6], b: any = [1, 2, 3, 4, 5, 6], c: any = a, d: any = [1, 2, 3, 4, 5, 6]; return f8(a, b, c, d, 6, 2); });
attempt('8.1', () => { n0 = 0; const a: any = [2147483647, 1, 2147483646, 5], b: any = [0.5, 1.5, -2.5, 3, 4.25, -0], c: any = b, d: any = [1, 2, 3, undefined, 5]; return f8(a, b, c, d, 3, undefined); });
attempt('8.2', () => { n0 = 0; const a: any = [1, 2, 3, 4, 5, 6], b: any = [1, 2, 3, "x", 5, 6], c: any = Object.freeze([1, 2, 3, 4]), d: any = [1, 2, 3, 4, 5, 6, 0.5, 8]; return f8(a, b, c, d, a.length, "s"); });
attempt('8.3', () => { n0 = 0; const a: any = [1, 2, 3, "x", 5, 6], b: any = [2147483647, 1, 2147483646, 5], c: any = a, d: any = [0.5, , 2.5, 3]; return f8(a, b, c, d, 3, NaN); });
attempt('8.4', () => { n0 = 0; const a: any = [1, 2, 3, 4, 5, 6, 0.5, 8], b: any = [1, 2.5, 3, NaN, 5, 6], c: any = a, d: any = [0.5, , 2.5, 3]; return f8(a, b, c, d, a.length, 0.5); });
attempt('8.5', () => { n0 = 0; const a: any = [1, 2, 3, 4, 5, 6], b: any = [1, 2, 3, "x", 5, 6], c: any = [1, 2, 3, 4, { valueOf() { n0++; return 7; } }, 6], d: any = [1n, 2n]; return f8(a, b, c, d, 6, -1); });
console.log(lines.join('\n'));
export {};
