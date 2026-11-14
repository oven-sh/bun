'use strict';
const log = [];
class Row { constructor(i) { this.id = i * 5 % 7; this.age = i * 3 % 4; this.score = i % 2; } get double() { return this.id * 2; } name() { return 'row'; } }
const show = v => { try { return JSON.stringify(v, (k, x) => typeof x === 'function' ? 'fn ' + x.name : typeof x === 'symbol' ? String(x) : x === undefined ? 'undef' : typeof x === 'number' && x !== x ? 'NaN' : x); } catch (e) { return 'json ' + e.message; } };
const pick = (row, key) => row[key];
function map_(list, key, wanted, other) { return list.map(row => row[key]); }
function sub_(list, key, wanted, other) { return [...list].sort((a, b) => a[key] - b[key]).map(row => row.id); }
function filter_(list, key, wanted, other) { return list.filter(row => row[key] === wanted).length; }
function some_(list, key, wanted, other) { return [list.some(row => row[key] === wanted), list.every(row => row[key] !== wanted)]; }
function of_(list, key, wanted, other) { return (() => { const out = []; for (const row of list) out.push(row[key]); return out; })(); }
function store_(list, key, wanted, other) { return (() => { list.forEach(row => { row[key] = row.id + 1; }); return list.map(row => row[key]); })(); }
function call_(list, key, wanted, other) { return (() => { try { return list.map(row => row[key]()); } catch (e) { return e.constructor.name; } })(); }
function group_(list, key, wanted, other) { return (() => { const g = new Map(); list.forEach(row => { const k = row[key]; g.set(k, (g.get(k) || 0) + 1); }); return [...g].map(String); })(); }
function two_(list, key, wanted, other) { return list.map(row => row[key] + '/' + row[other]); }
function in_(list, key, wanted, other) { return list.map(row => [key in row, typeof row[key]]); }
const make = () => (() => { const l = [{ id: 1, age: 2, score: 3 }, { id: 4, age: 5, score: 6 }]; Object.defineProperty(l[1], 'age', { get() { log.push('defined'); return 77; }, configurable: true, enumerable: true }); return l; })();
const keys = process.argv.slice(2); if (!keys.length) keys.push('id', 'age', 'score', ['a', 'ge'].join(''), 'missing', 'constructor', '0');
for (let t = 0; t < 2; t++) for (let k = 0; k < keys.length; k++) {
  try { log.length = 0; const out = map_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('map', k, show(out), log.join()); } catch (e) { console.log('map', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = sub_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('sub', k, show(out), log.join()); } catch (e) { console.log('sub', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = filter_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('filter', k, show(out), log.join()); } catch (e) { console.log('filter', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = some_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('some', k, show(out), log.join()); } catch (e) { console.log('some', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = of_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('of', k, show(out), log.join()); } catch (e) { console.log('of', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = store_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('store', k, show(out), log.join()); } catch (e) { console.log('store', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = call_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('call', k, show(out), log.join()); } catch (e) { console.log('call', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = group_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('group', k, show(out), log.join()); } catch (e) { console.log('group', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = two_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('two', k, show(out), log.join()); } catch (e) { console.log('two', k, e.constructor.name, e.message, log.join()); }
  try { log.length = 0; const out = in_(make(), keys[k], 2, keys[(k + 1) % 3]); console.log('in', k, show(out), log.join()); } catch (e) { console.log('in', k, e.constructor.name, e.message, log.join()); }
}
