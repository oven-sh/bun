// A prototype is replaced by a literal that has getters and setters, and what they are changes before and after the first use.
var count = 0;
function say(what, f) { try { console.log(what, f(), count); } catch (e) { console.log(what, e.constructor.name, count); } }
function sum(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var e = all[i % all.length]; s = (s * 3 + e.key + e.value) % 100003; } return s; }
function store(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var e = all[i % all.length]; e.key = i; e.value = i; s = (s * 3 + e._k + e._v) % 100003; } return s; }
console.log('getters alone');
(function () {
  function E(k, v) { this._k = k; this._v = v; }
  E.prototype = { get key() { return this._k; }, get value() { count++; return this._v; }, both: function () { return this.key + this.value; } };
  var all = []; for (var i = 0; i < 5; i++) all.push(new E(i, i * 2));
  say('sum', function () { return sum(all, 40); });
  say('both', function () { return all[3].both(); });
  say('sloppy store', function () { all[0].key = 9; return all[0].key + ' ' + Object.keys(all[0]); });
  say('keys', function () { var n = []; for (var k in all[1]) n.push(k); return n.join() + ' ' + JSON.stringify(all[1]) + ' ' + all[1].hasOwnProperty('key') + ('key' in all[1]); });
  say('descriptor', function () { var d = Object.getOwnPropertyDescriptor(E.prototype, 'key'); return [typeof d.get, typeof d.set, d.enumerable, d.configurable, d.get.call({ _k: 41 })].join(); });
  say('own', function () { Object.defineProperty(all[2], 'key', { value: 100 }); return sum(all, 40); });
  say('replaced', function () { Object.defineProperty(E.prototype, 'key', { get: function () { return 7; }, configurable: true }); return sum(all, 40) + all[3].both(); });
  say('deleted', function () { delete E.prototype.value; return sum(all, 40); });
})();
console.log('getters and setters');
(function () {
  function E(k, v) { this._k = k; this._v = v; this.key = k + 1; }
  E.prototype = { get key() { return this._k * 2; }, set key(x) { count += 10; this._k = x; }, set value(x) { this._v = x; }, get value() { return this._v; } };
  var all = []; for (var i = 0; i < 4; i++) all.push(new E(i, i));
  say('sum', function () { return sum(all, 30); });
  say('store', function () { return store(all, 30); });
  say('text', function () { all[1].key = 'text'; return sum(all, 5) + ' ' + typeof all[1].key; });
  say('setter out', function () { Object.defineProperty(E.prototype, 'key', { set: undefined }); return store(all, 30); });
  say('value instead', function () { Object.defineProperty(E.prototype, 'value', { value: 3, writable: true }); return store(all, 30) + ' ' + Object.keys(all[0]); });
})();
console.log('below a parent');
(function () {
  function B() { }
  B.prototype = { get key() { return -1; }, get value() { return -2; }, get only() { return this._k; } };
  function E(k, v) { this._k = k; this._v = v; }
  E.prototype = { __proto__: B.prototype, get key() { return this._k; } };
  function F(k, v) { this._k = k; this._v = v; }
  F.prototype = { get value() { return this._v; } };
  F.prototype.__proto__ = B.prototype;
  var all = []; for (var i = 0; i < 6; i++) all.push(i & 1 ? new E(i, i) : new F(i, i));
  say('sum', function () { return sum(all, 30); });
  say('only', function () { return all[2].only + all[3].only; });
  say('parent changes', function () { Object.defineProperty(B.prototype, 'key', { value: 50 }); return sum(all, 30); });
  say('parent goes', function () { Object.setPrototypeOf(F.prototype, null); return sum(all, 30) + typeof all[2].only; });
})();
console.log('late, twice, under a computed name, twice under one name');
(function () {
  function E(k, v) { this._k = k; this._v = v; }
  var early = new E(1, 2);
  say('early', function () { return typeof early.key; });
  E.prototype = { get key() { return this._k; }, get value() { return this._v; } };
  say('late', function () { return sum([new E(3, 4), new E(5, 6)], 20) + typeof early.key; });
  function make(z) { function E(k) { this._k = k; } E.prototype = { get key() { return this._k + z; }, get value() { return z; } }; return E; }
  var M = make(1), N = make(2);
  say('twice', function () { return sum([new M(1), new N(1), new M(2)], 20); });
  function C(k) { this._k = k; }
  C.prototype = { get ['k' + 'ey']() { return this._k; }, get value() { return 1; } };
  say('computed', function () { return sum([new C(1), new C(2)], 20); });
  function D(k) { this._k = k; }
  D.prototype = { get key() { return -5; }, get key() { return this._k; }, value: 1, get value() { return 2; } };
  say('one name', function () { return sum([new D(1), new D(2)], 20); });
  function G(k) { this._k = k; }
  var shared = { get key() { return this._k; }, get value() { return 0; } };
  function H(k) { this._k = k * 2; }
  G.prototype = shared; H.prototype = shared;
  say('shared', function () { return sum([new G(1), new H(1)], 20); });
})();
