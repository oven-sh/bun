// The parent of a prototype object is named by a literal or by a store under __proto__, and changed before and after its first use.
function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
console.log('literal late-proto');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { __proto__: B.prototype, constructor: D, own: function () { return this.get(); } };
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { D.prototype.__proto__ = C.prototype; } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('literal twice');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { __proto__: B.prototype, constructor: D, own: function () { return this.get(); } };
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  D.prototype.__proto__ = C.prototype;
  say('fill', function () { fill(); return all.length; });
  look('first');
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('literal null');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { __proto__: B.prototype, constructor: D, own: function () { return this.get(); } };
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { Object.setPrototypeOf(D.prototype, null); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('literal getter-first');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { __proto__: B.prototype, constructor: D, own: function () { return this.get(); } };
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  Object.defineProperty(B.prototype, 'i', { get() { return 7; }, set(v) { seen += v; }, configurable: true });
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { console.log(seen); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('literal own-proto');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { __proto__: B.prototype, constructor: D, own: function () { return this.get(); } };
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  Object.defineProperty(B.prototype, '__proto__', { value: 1, writable: true, configurable: true, enumerable: true });
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { D.prototype.__proto__ = C.prototype; console.log(Object.keys(D.prototype).join(), all[0].__proto__ === C.prototype); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('literal in-loop');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { __proto__: B.prototype, constructor: D, own: function () { return this.get(); } };
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { for (var q = 0; q < 60; q++) { if (q === 30) { D.prototype.__proto__ = C.prototype; fill(); } all[q % all.length].step(); } } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('proto-store late-proto');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { own: function () { return this.get(); } };
  D.prototype.__proto__ = B.prototype;
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { D.prototype.__proto__ = C.prototype; } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('proto-store twice');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { own: function () { return this.get(); } };
  D.prototype.__proto__ = B.prototype;
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  D.prototype.__proto__ = C.prototype;
  say('fill', function () { fill(); return all.length; });
  look('first');
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('proto-store null');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { own: function () { return this.get(); } };
  D.prototype.__proto__ = B.prototype;
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { Object.setPrototypeOf(D.prototype, null); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('proto-store getter-first');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { own: function () { return this.get(); } };
  D.prototype.__proto__ = B.prototype;
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  Object.defineProperty(B.prototype, 'i', { get() { return 7; }, set(v) { seen += v; }, configurable: true });
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { console.log(seen); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('proto-store own-proto');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { own: function () { return this.get(); } };
  D.prototype.__proto__ = B.prototype;
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  Object.defineProperty(B.prototype, '__proto__', { value: 1, writable: true, configurable: true, enumerable: true });
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { D.prototype.__proto__ = C.prototype; console.log(Object.keys(D.prototype).join(), all[0].__proto__ === C.prototype); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('proto-store in-loop');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  B.make = function (n) { return new this(n); };
  function C(n) { this.n = n; this.i = 100; this.c = 'c'; }
  C.prototype.step = function () { this.i += 2; return this.i; };
  C.prototype.get = function () { return String(this.n) + '!'; };
  C.prototype.only = function () { return 'only C'; };
  C.make = function (n) { return 'made by C'; };
  var seen = 0;
  function D(n) { this.n = n; this.i = 0; }
  D.prototype = { own: function () { return this.get(); } };
  D.prototype.__proto__ = B.prototype;
  var all = [];
  function fill() { for (var k = 1; k <= 4; k++) all.push(new D(k)); }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; } return s + t; }
  function look(what) {
    say(what, function () { return run(50); });
    say('is', function () { return [all[0] instanceof B, all[0] instanceof C, all[0] instanceof D, B.prototype.isPrototypeOf(all[0]), C.prototype.isPrototypeOf(D.prototype)].join(); });
    say('above', function () { var p = Object.getPrototypeOf(D.prototype); return p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === Object.prototype ? 'O' : p === null ? 'null' : 'other'; });
    say('names', function () { var k = []; for (var n in all[0]) k.push(n); return k.join(); });
    say('keys', function () { return Object.keys(all[1]).join() + ' ' + JSON.stringify(all[1]); });
    say('made', function () { var m = D.make && D.make(3); return typeof m === 'object' ? m.own() + m.step() : m; });
    say('constructor', function () { return all[0].constructor === D ? 'D' : all[0].constructor === B ? 'B' : all[0].constructor === C ? 'C' : 'other'; });
    say('only', function () { return typeof all[0].only + ' ' + all[0].only(); });
    say('super_', function () { return D.super_ === B ? 'B' : D.super_ === C ? 'C' : typeof D.super_; });
  }
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { for (var q = 0; q < 60; q++) { if (q === 30) { D.prototype.__proto__ = C.prototype; fill(); } all[q % all.length].step(); } } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
