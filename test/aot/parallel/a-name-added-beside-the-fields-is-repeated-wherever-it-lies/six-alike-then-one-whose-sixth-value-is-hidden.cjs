'use strict';
// COUNTER: SlowPropertyAdditionsReplayed >= 50
const N = JSON.parse('[' + Array.from({ length: 80 }, (_, i) => '"n' + i + '"').join() + ']');
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
function make(r) { const o = {}; for (let i = 0; i < 10; i++) { if (r === 6 && i === 5) define(o, N[i], { value: i, writable: true, enumerable: false, configurable: true }); else define(o, N[i], { value: i, writable: true, enumerable: true, configurable: true }); } return o; }
const rounds = JSON.parse('11');
const kept = [];
const out = [];
for (let r = 0; r < rounds; r++) { let made; try { made = make(r); } catch (error) { out.push(r + ' ' + error.constructor.name + ': ' + String(error.message).split(' (')[0]); continue; } kept.push(made); out.push(r + ' ' + describe(made)); }
Bun.gc(true); for (let filler = 0; filler < 3000; filler++) globalThis.lastFiller = { at: 'filler' + filler, more: [filler] }; Bun.gc(true);
for (const made of kept) out.push('later ' + describe(made));
console.log(out.join('\n'));
