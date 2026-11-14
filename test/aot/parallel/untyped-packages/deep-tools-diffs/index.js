// clone, merge, equality, differences, paths, freezing and mapping over anything
'use strict';
const tag = v => Object.prototype.toString.call(v).slice(8, -1);
function clone(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  let out;
  switch (tag(v)) {
    case 'Array': out = new Array(v.length); seen.set(v, out); for (const k of Object.keys(v)) out[k] = clone(v[k], seen); return out;
    case 'Date': out = new Date(+v); break;
    case 'RegExp': out = new RegExp(v.source, v.flags); out.lastIndex = v.lastIndex; break;
    case 'Map': out = new Map(); seen.set(v, out); for (const [k, x] of v) out.set(clone(k, seen), clone(x, seen)); return out;
    case 'Set': out = new Set(); seen.set(v, out); for (const x of v) out.add(clone(x, seen)); return out;
    case 'Error': out = Object.create(Object.getPrototypeOf(v)); for (const k of Object.getOwnPropertyNames(v)) if (k === 'message' || Object.prototype.propertyIsEnumerable.call(v, k) && !/^(line|column|source)/.test(k)) Object.defineProperty(out, k, { ...Object.getOwnPropertyDescriptor(v, k) }); return out;
    case 'ArrayBuffer': return v.slice(0);
    default: if (ArrayBuffer.isView(v)) return new v.constructor(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  }
  if (out) { seen.set(v, out); return out; }
  out = Object.create(Object.getPrototypeOf(v)); seen.set(v, out);
  for (const k of Reflect.ownKeys(v)) { const d = Object.getOwnPropertyDescriptor(v, k); if ('value' in d) d.value = clone(d.value, seen); Object.defineProperty(out, k, d); }
  return out;
}
function merge(a, ...rest) { for (const b of rest) { if (!b) continue; for (const k of Object.keys(b)) { if (k === '__proto__') continue; const x = a[k], y = b[k]; if (Array.isArray(x) && Array.isArray(y)) y.forEach((v, i) => { x[i] = v && typeof v === 'object' && x[i] && typeof x[i] === 'object' ? merge(x[i], v) : v; }); else if (tag(x) === 'Object' && tag(y) === 'Object') merge(x, y); else if (y !== undefined) a[k] = clone(y); } } return a; }
function equal(a, b, seen = new Map()) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || tag(a) !== tag(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  if (a instanceof Date) return +a === +b;
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map || a instanceof Set) { if (a.size !== b.size) return false; for (const x of a) { const [k, v] = a instanceof Map ? x : [x, x]; if (a instanceof Map ? !b.has(k) || !equal(v, b.get(k), seen) : !b.has(k) && ![...b].some(y => equal(k, y, seen))) return false; } return true; }
  if (ArrayBuffer.isView(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false; return true; }
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k], seen));
}
function diff(a, b, path = [], out = []) { if (equal(a, b)) return out; const ta = tag(a); if (ta === tag(b) && (ta === 'Object' || ta === 'Array')) { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of keys) { const p = path.concat(k); if (!(k in b)) out.push({ op: 'remove', path: p.join('.') }); else if (!(k in a)) out.push({ op: 'add', path: p.join('.'), value: b[k] }); else diff(a[k], b[k], p, out); } } else out.push({ op: 'set', path: path.join('.'), value: b }); return out; }
const steps = p => Array.isArray(p) ? p : String(p).replace(/\[(?:(\d+)|"([^"]*)")\]/g, (m, n, s) => '.' + (n ?? s)).replace(/^\./, '').split('.');
const get = (o, p, d) => { for (const k of steps(p)) { if (o == null) return d; o = o[k]; } return o === undefined ? d : o; };
const set = (o, p, v) => { const s = steps(p), top = o; s.forEach((k, i) => { if (i === s.length - 1) o[k] = v; else o = o[k] = o[k] !== null && typeof o[k] === 'object' ? o[k] : /^\d+$/.test(s[i + 1]) ? [] : {}; }); return top; };
const freeze = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) freeze(v); }); return Object.freeze(o); };
const apply = (o, ops) => { o = clone(o); for (const { op, path, value } of ops) { const s = path.split('.'), last = s.pop(), at = s.length ? get(o, s) : o; if (op === 'remove') Array.isArray(at) ? at.length = Math.min(at.length, +last) : delete at[last]; else at[last] = clone(value); } return o; };
module.exports = { clone, merge, equal, diff, apply, get, set, freeze, tag };
