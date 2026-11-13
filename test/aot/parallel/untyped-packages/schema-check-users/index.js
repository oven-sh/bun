// schemas made by chained calls, compiled to closures; references, unions, transforms, paths of errors
'use strict';
class Issue { constructor(path, message) { this.path = path; this.message = message; } toString() { return (this.path.length ? this.path.map((p, i) => typeof p === 'number' ? '[' + p + ']' : (i ? '.' : '') + p).join('') + ': ' : '') + this.message; } }
class SchemaError extends Error { constructor(issues) { super(issues.join('; ')); this.name = 'SchemaError'; this.issues = issues; } }
class Type {
  constructor(def) { this.def = def; this.checks = []; this.steps = []; }
  copy(change) { const c = Object.create(Object.getPrototypeOf(this)); c.def = { ...this.def }; c.checks = this.checks.slice(); c.steps = this.steps.slice(); if (change) change(c); return c; }
  check(test, message) { return this.copy(c => c.checks.push({ test, message })); }
  optional() { return this.copy(c => { c.def.optional = true; }); }
  nullable() { return this.copy(c => { c.def.nullable = true; }); }
  default(v) { return this.copy(c => { c.def.default = v; c.def.hasDefault = true; }); }
  transform(f) { return this.copy(c => c.steps.push(f)); }
  or(o) { return new Union({ options: [this, o] }); }
  run(v, path, issues) {
    if (v === undefined) { if (this.def.hasDefault) v = typeof this.def.default === 'function' ? this.def.default() : this.def.default; else if (this.def.optional) return undefined; }
    if (v === null && this.def.nullable) return null;
    const before = issues.length;
    let out = this.inner(v, path, issues);
    if (issues.length === before) { for (const { test, message } of this.checks) { const ok = test(out); if (ok !== true) issues.push(new Issue(path, typeof message === 'function' ? message(out) : message)); } }
    if (issues.length === before) for (const f of this.steps) { try { out = f(out, path); } catch (e) { issues.push(new Issue(path, 'transform: ' + e.message)); break; } }
    return out;
  }
  wrong(v, path, issues, what) { issues.push(new Issue(path, v === undefined ? 'required' : 'expected ' + what + ', got ' + (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v))); return v; }
  safe(v) { const issues = [], value = this.run(v, [], issues); return issues.length ? { ok: false, issues } : { ok: true, value }; }
  parse(v) { const r = this.safe(v); if (!r.ok) throw new SchemaError(r.issues); return r.value; }
}
class Text extends Type { inner(v, p, i) { if (this.def.coerce && v != null) v = String(v); return typeof v === 'string' ? this.def.trim ? v.trim() : v : this.wrong(v, p, i, 'string'); } min(n) { return this.check(s => s.length >= n, 'at least ' + n + ' characters'); } max(n) { return this.check(s => s.length <= n, s => 'at most ' + n + ' characters, got ' + s.length); } match(re, m) { return this.check(s => re.test(s), m || 'must match ' + re); } trim() { return this.copy(c => { c.def.trim = true; }); } email() { return this.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be an email'); } }
class Num extends Type { inner(v, p, i) { if (this.def.coerce && typeof v === 'string' && v.trim() !== '') v = +v; if (typeof v !== 'number' || v !== v) return this.wrong(v, p, i, 'number'); return v; } int() { return this.check(Number.isInteger, 'must be an integer'); } min(n) { return this.check(x => x >= n, 'must be >= ' + n); } max(n) { return this.check(x => x <= n, 'must be <= ' + n); } }
class Bool extends Type { inner(v, p, i) { return typeof v === 'boolean' ? v : this.wrong(v, p, i, 'boolean'); } }
class Lit extends Type { inner(v, p, i) { if (this.def.values.some(x => Object.is(x, v))) return v; i.push(new Issue(p, 'expected one of ' + this.def.values.map(x => JSON.stringify(x)).join(', '))); return v; } }
class List extends Type { inner(v, p, i) { if (!Array.isArray(v)) return this.wrong(v, p, i, 'array'); if (this.def.tuple) { if (v.length !== this.def.tuple.length) i.push(new Issue(p, 'expected ' + this.def.tuple.length + ' items')); return this.def.tuple.map((t, k) => t.run(v[k], p.concat(k), i)); } const out = []; for (let k = 0; k < v.length; k++) out.push(this.def.item.run(v[k], p.concat(k), i)); return out; } min(n) { return this.check(a => a.length >= n, 'at least ' + n + ' items'); } unique(key = x => x) { return this.check(a => new Set(a.map(key)).size === a.length, 'must be unique'); } }
class Obj extends Type {
  inner(v, p, i) { if (v === null || typeof v !== 'object' || Array.isArray(v)) return this.wrong(v, p, i, 'object'); const out = {}; for (const k in this.def.shape) { const r = this.def.shape[k].run(v[k], p.concat(k), i); if (r !== undefined || k in v) out[k] = r; } if (this.def.mode !== 'strip' || this.def.rest) for (const k of Object.keys(v)) { if (Object.prototype.hasOwnProperty.call(this.def.shape, k)) continue; if (this.def.rest) out[k] = this.def.rest.run(v[k], p.concat(k), i); else if (this.def.mode === 'strict') i.push(new Issue(p, 'unknown key ' + k)); else out[k] = v[k]; } return out; }
  strict() { return this.copy(c => { c.def.mode = 'strict'; }); } loose() { return this.copy(c => { c.def.mode = 'loose'; }); } rest(t) { return this.copy(c => { c.def.rest = t; }); }
  extend(s) { return this.copy(c => { c.def.shape = { ...c.def.shape, ...s }; }); } pick(...k) { return this.copy(c => { c.def.shape = Object.fromEntries(Object.entries(c.def.shape).filter(([n]) => k.includes(n))); }); } partial() { return this.copy(c => { c.def.shape = Object.fromEntries(Object.entries(c.def.shape).map(([n, t]) => [n, t.optional()])); }); }
}
class Union extends Type { inner(v, p, i) { const all = []; for (const o of this.def.options) { const mine = []; const r = o.run(v, p, mine); if (!mine.length) return r; all.push(mine); } const best = all.reduce((a, b) => Math.max(...b.map(x => x.path.length)) > Math.max(...a.map(x => x.path.length)) ? b : a); i.push(new Issue(p, 'no option fits (' + best.join(', ') + ')')); return v; } or(o) { return this.copy(c => { c.def.options = [...c.def.options, o]; }); } }
class Lazy extends Type { inner(v, p, i) { return (this.def.type ??= this.def.make()).run(v, p, i); } }
const s = { text: () => new Text({}), num: () => new Num({}), bool: () => new Bool({}), lit: (...values) => new Lit({ values }), list: item => new List({ item }), tuple: (...tuple) => new List({ tuple }), obj: shape => new Obj({ shape, mode: 'strip' }), union: (...options) => new Union({ options }), lazy: make => new Lazy({ make }), coerce: { num: () => new Num({ coerce: true }), text: () => new Text({ coerce: true }) } };
module.exports = { s, SchemaError, Issue, Type };
