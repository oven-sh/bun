// Callees tell values apart by typeof, by comparison with themselves and by (x | 0) == x. Calls in loops pass one kind, several kinds, and kinds that change.
globalThis.self = globalThis;
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
function same(a, b) { if (typeof a != typeof b) return false; switch (typeof a) { case 'object': if (!a) return !b; case 'function': return a === b; default: return a == b; } }
function real(x) { if (typeof x === 'number') { if (x !== x) return -1; return x === (x | 0) ? 1 : 2; } return typeof x === 'string' ? x.length : 0; }
function itself(x) { return typeof x === 'number' ? (x === x ? 1 : 1000) : 5; }
function Table() { this.slots = new Array(64); this.size = 0; }
function Entry(key, hash, next) { this.key = key; this.hash = hash; this.next = next; }
Table.prototype = {
  find: function (key, index, h) { var e = this.slots[index]; while (e && (e.hash != h || !same(key, e.key))) e = e.next; return e; },
  entry: function (key) { var h = hash(key); return this.find(key, h & (this.slots.length - 1), h); },
  has: function (key) { var e = this.entry(key); if (e) return e.key; return null; },
  add: function (key) { var h = hash(key), index = h & (this.slots.length - 1); if (this.find(key, index, h)) return; this.slots[index] = new Entry(key, h, this.slots[index]); this.size++; },
};
var fun = function () { return 1; }; fun.hashCode = function () { return 77; };
var nan = [1, NaN, 2], mixed = [1, 'k', 0.5, NaN, true, null, undefined, fun, -0, 70000, 4294967296];
function ints(n) { var s = 0; for (var i = 0; i < n; i++) s = (s * 31 + hash(i) + real(i & 7) + (same(i, i & 15) ? 1 : 0) + itself(i)) | 0; return s; }
function halves(n) { var s = 0; for (var i = 0; i < n; i++) s = (s * 31 + hash(i * 0.5) + real(i * 0.5) + itself(i * 0.5)) | 0; return s; }
function strings(n) { var s = 0; for (var i = 0; i < n; i++) s = (s * 31 + hash('k' + (i & 3)) + real('ab') + (same('a' + (i & 1), 'a1') ? 1 : 0)) | 0; return s; }
function nans(n) { var s = 0; for (var i = 0; i < n; i++) s = s + itself(nan[i % 3]) + real(nan[i % 3]) * 10 + itself(i % 5 ? i : NaN) + real(0 / (i % 3)); return s; }
function kinds(n) { var s = 0; for (var i = 0; i < n; i++) { var v = mixed[i % mixed.length]; s = (s * 31 + hash(v) + real(v) + itself(v) + (same(v, v) ? 7 : 1)) | 0; } return s; }
function table(n, make) { var t = new Table(), s = 0; for (var i = 0; i < n; i++) t.add(make(i)); for (var j = 0; j < 3; j++) for (var i = 0; i < n; i++) { var k = t.has(make(i)); s += k === null ? 1000000 : same(k, make(i)) ? 1 : 100; } return s + ' ' + t.size; }
function wholeTable(n) { var t = new Table(), s = 0; for (var i = 0; i < n; i++) t.add(i); for (var j = 0; j < 3; j++) for (var i = 0; i < n + 5; i++) s += t.has(i); return s + ' ' + t.size; }
function all() { console.log(ints(300), halves(100), strings(100), nans(60), kinds(110), wholeTable(200), table(50, function (i) { return 's' + i; }), table(50, function (i) { return i % 3 ? i : 's' + i; }), table(9, function (i) { return i ? i / 4 : NaN; })); }
all(); all();
Number.prototype.hashCode = function () { return 5; };
var plain = Table.prototype.find;
Table.prototype.find = function (key, index, h) { this.size = this.size; return plain.call(this, key, index, h); };
all();
Table.prototype.entry = function () { return null; };
all();
