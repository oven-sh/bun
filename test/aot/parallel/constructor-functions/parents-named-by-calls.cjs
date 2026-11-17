// The parent of a prototype object is named by a call after a literal that names none, and changed before and after its first use.
function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
console.log('set late');
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
  Object.setPrototypeOf(D.prototype, B.prototype);
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
  try { Object.setPrototypeOf(D.prototype, C.prototype); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('set alias');
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
  Object.setPrototypeOf(D.prototype, B.prototype);
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
  var P = D.prototype;
  say('fill', function () { fill(); return all.length; });
  look('first');
  try { Object.setPrototypeOf(P, C.prototype); fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('set proxy-late');
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
  Object.setPrototypeOf(D.prototype, B.prototype);
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
  try { Object.setPrototypeOf(D.prototype, new Proxy(B.prototype, { get(t, k, r) { if (k === 'step') seen++; return Reflect.get(t, k, r); } })); run(10); console.log(seen); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('set instance');
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
  Object.setPrototypeOf(D.prototype, B.prototype);
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
  try { Object.setPrototypeOf(all[1], C.prototype); all[1].own = function () { return this.get(); }; } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('set frozen');
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
  Object.setPrototypeOf(D.prototype, B.prototype);
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
  Object.freeze(D.prototype);
  say('fill', function () { fill(); return all.length; });
  look('first');
  say('frozen', function () { Object.setPrototypeOf(D.prototype, C.prototype); return 'no'; });
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
