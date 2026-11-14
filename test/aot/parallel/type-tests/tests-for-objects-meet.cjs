// Values are told apart by typeof, and the ways behind tests for objects and for functions meet, in switches, in conditions and in loops.
globalThis.self = globalThis;
function P(n) { this.n = n; }
P.prototype.hashCode = function () { return this.n * 3; };
P.prototype.equals = function (other) { return other instanceof P && other.n === this.n; };
var fun = function () { return 1; };
fun.hashCode = function () { return 77; };
fun.equals = function (other) { return other === fun; };
function hash(key) {
  switch (typeof key) {
    case 'undefined': return 0;
    case 'object': if (!key) return 0;
    case 'function': return key.hashCode();
    case 'boolean': return key | 0;
    case 'number': if ((key | 0) == key) return key; key = '' + key;
    case 'string': var h = 0; for (var i = 0; i < key.length; i++) h = (((31 * h) | 0) + key.charCodeAt(i)) | 0; return h;
    default: throw new Error('bad');
  }
}
function equals(a, b) {
  if (typeof a != typeof b) return false;
  switch (typeof a) {
    case 'object': if (!a) return !b;
    case 'function': switch (typeof b) { case 'object': case 'function': return a.equals(b); default: return false; }
    default: return a == b;
  }
}
function isObject(x) { return (typeof x === 'object' && x !== null) || typeof x === 'function'; }
function name(x) { if ((typeof x === 'object' && x !== null) || typeof x === 'function') return x.hashCode ? 'has ' + x.hashCode() : 'none'; return 'primitive ' + String(x); }
function walk(x) { var t = ''; if (typeof x === 'object') { do { t += x === null ? 'null' : 'o'; x = x && x.next; } while (typeof x === 'object' && x); } return t + typeof x; }
function swap(x, y) { var t = ''; for (var i = 0; i < 3; i++) { if (typeof x === 'function' || typeof x === 'object') { t += x ? typeof x.hashCode : 'n'; x = y; } else { t += typeof x + x; x = i ? fun : null; } } return t; }
var values = [1, -5, 0.5, -0, NaN, 70000, 4294967296, 's', 'text', '', true, false, null, undefined, new P(4), new P(5), fun];
function text(v) { return Object.is(v, -0) ? '-0' : typeof v + ':' + String(v); }
for (var round = 0; round < 3; round++) {
  for (var v of values) {
    var line = [];
    try { line.push(text(hash(v))); } catch (e) { line.push(e.message); }
    try { line.push(values.map(function (w) { return equals(v, w) ? 1 : 0; }).join('')); } catch (e) { line.push(e.constructor.name); }
    line.push(isObject(v), v === fun ? 'fun' : name(v), walk(v), swap(v === fun ? 1 : v, v === fun ? 2 : v));
    console.log(line.join(' '));
  }
  if (round == 0) Number.prototype.hashCode = function () { return 1000 + this; };
  if (round == 1) { P.prototype.hashCode = function () { return 'changed'; }; String.prototype.equals = function () { return 5; }; }
}
var ints = 0;
for (var i = 0; i < 2000; i++) ints = (ints * 31 + hash(i) + (equals(i, i & 1023) ? 1 : 0) + (equals(i, i) ? 3 : 0)) | 0;
console.log(ints, walk({ next: { next: 5 } }), walk({ next: null }), walk({ next: { next: 'z' } }));
try { hash(Symbol.iterator); } catch (e) { console.log(e.message); }
