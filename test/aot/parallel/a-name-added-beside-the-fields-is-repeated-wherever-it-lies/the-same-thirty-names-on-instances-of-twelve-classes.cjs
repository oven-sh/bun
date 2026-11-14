'use strict';
// COUNTER: SlowPropertyAdditionsReplayed >= 1800
const N = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => '"n' + i + '"').join() + ']');
const define = Object.defineProperty;
function show(value) { return typeof value === 'function' ? 'fn' : typeof value === 'symbol' ? String(value) : typeof value === 'object' && value ? '{' + Reflect.ownKeys(value).map(String).join() + '}' : Object.is(value, -0) ? '-0' : String(value); }
function describe(o) {
  const parts = [];
  for (const key of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    parts.push(String(key) + (d.enumerable ? 'e' : '') + (d.configurable ? 'c' : '') + ('value' in d ? (d.writable ? 'w' : '') + '=' + show(d.value) : (d.get ? 'G' : '') + (d.set ? 'S' : '')));
  }
  let read = '';
  for (const key of Reflect.ownKeys(o)) { try { read += show(o[key]) + ','; } catch (error) { read += error.constructor.name + ','; } }
  let walked = ''; for (const key in o) walked += key + ',';
  let copied; try { copied = Object.keys({ ...o }).join(); } catch (error) { copied = error.constructor.name; }
  let text; try { text = JSON.stringify(o); } catch (error) { text = error.constructor.name; }
  let pairs; try { pairs = Object.entries(o).map(([k, v]) => k + ':' + show(v)).join(); } catch (error) { pairs = error.constructor.name; }
  return parts.join(' ') + ' | ' + read + ' | ' + walked + ' | ' + copied + ' | ' + text + ' | ' + pairs;
}
class K0 { constructor(t) { this.a = t; this.b0 = t; } }
class K1 { constructor(t) { this.a = t; this.b1 = t; } }
class K2 { constructor(t) { this.a = t; this.b2 = t; } }
class K3 { constructor(t) { this.a = t; this.b3 = t; } }
class K4 { constructor(t) { this.a = t; this.b4 = t; } }
class K5 { constructor(t) { this.a = t; this.b5 = t; } }
class K6 { constructor(t) { this.a = t; this.b6 = t; } }
class K7 { constructor(t) { this.a = t; this.b7 = t; } }
class K8 { constructor(t) { this.a = t; this.b8 = t; } }
class K9 { constructor(t) { this.a = t; this.b9 = t; } }
class K10 { constructor(t) { this.a = t; this.b10 = t; } }
class K11 { constructor(t) { this.a = t; this.b11 = t; } }
const K = [K0, K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11];
const kinds = 12, rounds = JSON.parse('96');
function make(r) { const o = new K[r % kinds](r); for (let i = 0; i < 30; i++) define(o, N[i], i % 5 === 4 ? { get: () => i, enumerable: true } : { value: r + i, enumerable: true, writable: true, configurable: true }); return o; }
const kept = [];
const out = [];
let sum = 0;
for (let r = 0; r < rounds; r++) { const made = make(r); if (r >= rounds - kinds) { kept.push(made); out.push(r + ' ' + describe(made)); } else sum += made[N[0]]; }
out.push('sum ' + sum);
Bun.gc(true); for (let filler = 0; filler < 3000; filler++) globalThis.lastFiller = { at: 'filler' + filler, more: [filler] }; Bun.gc(true);
for (const made of kept) out.push('later ' + describe(made));
console.log(out.join('\n'));
