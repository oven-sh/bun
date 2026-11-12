'use strict';
// COUNTER: SlowPropertyAdditionsReplayed >= 1100
const N = JSON.parse('[' + Array.from({ length: 160 }, (_, i) => '"n' + i + '"').join() + ']');
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
const kinds = 2, rounds = JSON.parse('12');
function make(r) { const o = {}; for (let i = 0; i < 160; i++) define(o, N[i], { value: r + i, enumerable: true, writable: true, configurable: true }); return o; }
const kept = [];
const out = [];
let sum = 0;
for (let r = 0; r < rounds; r++) { const made = make(r); if (r >= rounds - kinds) { kept.push(made); out.push(r + ' ' + describe(made)); } else sum += Reflect.ownKeys(made).length; }
out.push('sum ' + sum);
Bun.gc(true); for (let filler = 0; filler < 3000; filler++) globalThis.lastFiller = { at: 'filler' + filler, more: [filler] }; Bun.gc(true);
for (const made of kept) out.push('later ' + describe(made));
console.log(out.join('\n'));
