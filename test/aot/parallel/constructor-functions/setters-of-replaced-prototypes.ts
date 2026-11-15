const lines: any = [];
function show(v: any, d: number = 0): string { return d > 3 ? 'deep' : v === undefined ? 'u' : Object.is(v, -0) ? '-0' : typeof v === 'string' ? (/function|class |=>/.test(v) ? 'src' : JSON.stringify(v)) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? v.length > 5000 ? 'long' + v.length + Object.keys(v).slice(0, 40) : '[' + Array.from({ length: v.length }, (_: any, i: number) => i in v ? show(v[i], d + 1) : 'hole').join() + ']' : typeof v === 'function' ? 'fn' : v instanceof Map ? 'M' + show([...v], d + 1) : v instanceof Set ? 'S' + show([...v], d + 1) : ArrayBuffer.isView(v) ? 'V' + Array.from(v as any).join('/') : v instanceof Error ? v.name + ':' + v.message : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => k + ':' + show(v[k], d + 1)).join() + '}' : String(v); }
function attempt(n: any, f: any) { let r: any; try { r = show(f()); } catch (e: any) { } lines.push(n + ' ' + r); }
let n0 = 0, hook: any = null; const kept: any = [], proto: any = { changed: 'P', m() { } }

function G0(this: any) { } (G0 as any).prototype.changed = 'G';
function F0(this: any, x: any) { this.a = x; if (x === 2) { (F0 as any).prototype = 5; } }
function f0(): any { const i = 1; const v: any = new (F0 as any)(i); }
attempt('0.1', () => { return [f0(), n0, kept.map((o: any) => o.changed + Object.keys(o).join(''))]; });

function F7(this: any, x: any) { { (F7 as any).prototype = { set late(v: any) { n0++; }, changed: 2 } } this.b = null; }
(F7 as any).prototype.old = 1;
function make7(x: any): any { const o: any = new (F7 as any)(x); return o; }
function f7(): any { [0, 1, 2].forEach((i: any) => { const v: any = (i & 1 ? new (F7 as any)(2) : make7(1)); v.late = 3; }); }
attempt('7.1', () => { return [f7(), n0, kept.map((o: any) => o.changed + Object.keys(o).join(''))]; });
console.log(lines.join('\n'));
// The store of v.late behind the construction meets no setter of the prototype that the body has stored.
