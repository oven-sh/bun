// functions with defaults, missing arguments and callbacks that take less or more than they are given
'use strict';
function range(a, b = a, step = a < b ? 1 : -1, map = x => x) { if (arguments.length === 1) { a = 0; } const out = []; for (let i = a; step > 0 ? i < b : i > b; i += step) out.push(map(i, out.length)); return out; }
function pad(s, n = 2, c = '0', left = true) { s = String(s); while (s.length < n) s = left ? c + s : s + c; return s; }
function clamp(x, lo = 0, hi = 1) { return x < lo ? lo : x > hi ? hi : x; }
function join(list, sep = ',', { prefix = '', suffix = prefix, map = String, limit = Infinity } = {}) { return prefix + list.slice(0, limit).map((x) => map(x)).join(sep) + suffix; }
function each(list, fn, self) { for (let i = 0, n = list.length; i < n; i++) if (fn.call(self, list[i], i, list) === false) return i; return list.length; }
function reduce(list, fn, start) { let i = 0, acc = start; if (arguments.length < 3) { if (!list.length) throw new TypeError('empty'); acc = list[i++]; } for (; i < list.length; i++) acc = fn(acc, list[i], i, list); return acc; }
function groupBy(list, key = 'k', into = {}) { const f = typeof key === 'function' ? key : x => x[key]; each(list, (x, i) => { const k = f(x, i); (Object.prototype.hasOwnProperty.call(into, k) ? into[k] : into[k] = []).push(x); }); return into; }
function sortBy(list, ...keys) { return list.slice().sort((a, b) => { for (let k of keys) { let d = 1; if (typeof k === 'string' && k[0] === '-') { d = -1; k = k.slice(1); } const x = typeof k === 'function' ? k(a) : a[k], y = typeof k === 'function' ? k(b) : b[k]; if (x < y) return -d; if (x > y) return d; } return 0; }); }
function make({ a = 1, b = a + 1, c: { d = b, ...rest } = {}, ...others } = {}, [x = d, y = x, ...more] = [], z = more.length) { return [a, b, d, JSON.stringify(rest), JSON.stringify(others), x, y, more.join('/'), z].join(); }
function over() { const n = arguments.length; switch (n) { case 0: return 'none'; case 1: return typeof arguments[0]; default: return over.apply(this, Array.prototype.slice.call(arguments, 1)) + n; } }
function debounceLog(fn, n = 3) { let calls = [], first; return function (...args) { if (!calls.length) first = this; calls.push(args.length ? args : ['-']); if (calls.length >= n) { const c = calls; calls = []; return fn.call(first, c.map(a => a.join('+')).join('|'), n); } }; }
module.exports = { range, pad, clamp, join, each, reduce, groupBy, sortBy, make, over, debounceLog };
