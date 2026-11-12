'use strict';
const log = [], keep = [];
class Row { constructor(i) { this.id = i; this.age = i * 2; } static [Symbol.toPrimitive](hint) { log.push('static ' + hint); this.prototype.late = 1; keep.push(this); return 5; } }
const rows = []; for (let i = 0; i < 6; i++) rows.push(new Row(i));
const keys = () => ['id', 'age', 'constructor', '__proto__', 'toString', 'valueOf', 'total', 'half', 'missing', 'hasOwnProperty', Symbol.toPrimitive, Symbol.toStringTag, 0].concat(process.argv.slice(2));
const show = v => typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.length > 0 : v) : typeof v === 'number' ? (v !== v ? 'NaN' : String(v)) : typeof v === 'object' && v ? 'object' : typeof v === 'function' ? 'function' : String(v);
function add_(list, key) { const out = []; for (const row of list) { const v = row[key]; out.push(v + 1); } return out; }
function state() { let s = 0; for (const row of rows) { s += typeof row.age === 'number' ? row.age : 1000; s += row.id; } return s + '/' + keep.length + '/' + (rows[0] instanceof Object) + '/' + Object.keys(rows[1]).join() + '/' + rows.map(r => r.constructor === undefined ? 'u' : r.constructor.name).join(); }
for (let t = 0; t < 2; t++) for (const key of keys()) {
  try { log.length = 0; const r = add_(rows, key); console.log(t, 'add', String(key), r.map(show).join(), log.join('|'), state()); } catch (e) { console.log(t, 'add', String(key), e.constructor.name, e.message.replace(/class Row[^]*/, 'class'), log.join('|'), state()); }
  for (const kept of keep.splice(0)) { try { kept.mark = 1; delete kept.mark; if (typeof kept === 'function') { const made = new kept(9); made.age = made.age + 1; console.log('made', made.id, made.age); } else { kept.id = kept.id; } } catch (e) { console.log('kept', e.constructor.name); } }
}
console.log(state());
