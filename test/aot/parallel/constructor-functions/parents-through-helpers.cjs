// One helper links several rows of classes: each call of it is followed by itself, and what a later call, a list or a replaced helper links is right.
console.log('extends--crossed');
(function () {
  var link = (function () {
      var extendStatics = function (d, b) {
          extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
          return extendStatics(d, b);
      };
      return function (d, b) {
          if (typeof b !== "function" && b !== null)
              throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
          extendStatics(d, b);
          function __() { this.constructor = d; }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
      };
  })();
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { link(DA, B); link(DB, A); DA.prototype.own = DB.prototype.own = function () { return "x" + this.get(); }; fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('extends--by-list');
(function () {
  var link = (function () {
      var extendStatics = function (d, b) {
          extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
          return extendStatics(d, b);
      };
      return function (d, b) {
          if (typeof b !== "function" && b !== null)
              throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
          extendStatics(d, b);
          function __() { this.constructor = d; }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
      };
  })();
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { [[DA, B], [DC, A]].forEach(function (p) { link(p[0], p[1]); p[0].prototype.own = function () { return "z" + this.get(); }; }); fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('extends--class-parent');
(function () {
  var link = (function () {
      var extendStatics = function (d, b) {
          extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
          return extendStatics(d, b);
      };
      return function (d, b) {
          if (typeof b !== "function" && b !== null)
              throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
          extendStatics(d, b);
          function __() { this.constructor = d; }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
      };
  })();
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  class K { step() { return 'K'; } get() { return 'k'; } static get kind() { return 'K'; } } link(DB, K); DB.prototype.own = function () { return 'K' + this.get(); }; fill();
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('extends--emitter');
(function () {
  var link = (function () {
      var extendStatics = function (d, b) {
          extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
          return extendStatics(d, b);
      };
      return function (d, b) {
          if (typeof b !== "function" && b !== null)
              throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
          extendStatics(d, b);
          function __() { this.constructor = d; }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
      };
  })();
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { var Emitter = require('node:events'); function Bus() { Emitter.call(this); this.sent = 0; } link(Bus, Emitter); say('bus', function () { var b = new Bus(), s = 0; b.on('x', function (v) { s += v; }); for (var i = 0; i < 20; i++) b.emit('x', i); return s + ' ' + (b instanceof Emitter); }); fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('loose--to-child');
(function () {
  function link(t, o) { t.prototype = Object.create(o.prototype), t.prototype.constructor = t, set(t, o); }
  function set(t, e) { return set = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, set(t, e); }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { link(DB, DA); DB.prototype.own = function () { return "y" + this.get(); }; fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('loose--by-call');
(function () {
  function link(t, o) { t.prototype = Object.create(o.prototype), t.prototype.constructor = t, set(t, o); }
  function set(t, e) { return set = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, set(t, e); }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { link.call(null, DA, C); DA.prototype.own = function () { return "c"; }; fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('loose--deep');
(function () {
  function link(t, o) { t.prototype = Object.create(o.prototype), t.prototype.constructor = t, set(t, o); }
  function set(t, e) { return set = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, set(t, e); }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  function G0(n) { A.call(this, n); this.g0 = n; } link(G0, A); G0.prototype.own = function () { return 'G0' + this.get(); }; all.push(new G0(0)); function G1(n) { G0.call(this, n); this.g1 = n; } link(G1, G0); G1.prototype.own = function () { return 'G1' + this.get(); }; all.push(new G1(1)); function G2(n) { G1.call(this, n); this.g2 = n; } link(G2, G1); G2.prototype.own = function () { return 'G2' + this.get(); }; all.push(new G2(2)); function G3(n) { G2.call(this, n); this.g3 = n; } link(G3, G2); G3.prototype.own = function () { return 'G3' + this.get(); }; all.push(new G3(3)); function G4(n) { G3.call(this, n); this.g4 = n; } link(G4, G3); G4.prototype.own = function () { return 'G4' + this.get(); }; all.push(new G4(4)); function G5(n) { G4.call(this, n); this.g5 = n; } link(G5, G4); G5.prototype.own = function () { return 'G5' + this.get(); }; all.push(new G5(5)); fill();
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('returns--result');
(function () {
  function link(Child, Parent) { Child.prototype = Object.create(Parent.prototype); Child.prototype.constructor = Child; Child.__super__ = Parent.prototype; return Child; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { var R = link(DA, A); say('result', function () { return R === DA ? 'child' : R === A ? 'parent' : R === undefined ? 'undefined' : typeof R; }); DA.prototype.own = function () { return 'q' + this.get(); }; fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('returns--in-loop');
(function () {
  function link(Child, Parent) { Child.prototype = Object.create(Parent.prototype); Child.prototype.constructor = Child; Child.__super__ = Parent.prototype; return Child; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { for (var q = 0; q < 50; q++) { if (q === 20) { link(DA, B); DA.prototype.own = function () { return 'l'; }; fill(); } all[q % all.length].step(); new DA(q).step(); } } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('goog--replaced');
(function () {
  function link(childCtor, parentCtor) { function tempCtor() {} tempCtor.prototype = parentCtor.prototype; childCtor.superClass_ = parentCtor.prototype; childCtor.prototype = new tempCtor(); childCtor.prototype.constructor = childCtor; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { var old = link; try { link = function (a, b) { old(a, C); }; } catch (e) { console.log(e.constructor.name); } try { link(DA, B); } catch (e) {} DA.prototype.own = function () { return "r"; }; fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('goog--late-names');
(function () {
  function link(childCtor, parentCtor) { function tempCtor() {} tempCtor.prototype = parentCtor.prototype; childCtor.superClass_ = parentCtor.prototype; childCtor.prototype = new tempCtor(); childCtor.prototype.constructor = childCtor; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { A.prototype.later = function () { return 'L' + this.n; }; say('later', function () { return new EA(3).later() + typeof new DB(1).later; }); A.kind = 'A2'; fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
console.log('keeps--crossed');
(function () {
  var kept = [];
  function link(a, b) { a.prototype = Object.create(b.prototype); kept.push(a); }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'A'; };
  A.prototype.get = function () { return this.n; };
  A.kind = 'A';
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'B'; };
  B.prototype.get = function () { return this.n; };
  B.kind = 'B';
  function C(n) { this.n = n; this.i = 0; }
  C.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i + 'C'; };
  C.prototype.get = function () { return this.n; };
  C.kind = 'C';
  function DA(n) { A.call(this, n); this.ofDA = n; }
  function DB(n) { B.call(this, n); this.ofDB = n; }
  function DC(n) { C.call(this, n); this.ofDC = n; }
  function EA(n) { DA.call(this, n); this.ofEA = n; }
  link(DA, A); link(DB, B); link(DC, C); link(EA, DA);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  DB.prototype.own = function () { return 'DB' + this.get(); };
  DC.prototype.own = function () { return 'DC' + this.get(); };
  EA.prototype.own = function () { return 'EA' + this.get(); };
  var all = [];
  function fill() { for (var q = 0; q < 2; q++) all.push(new DA(q), new DB(q), new DC(q), new EA(q)); }
  function run(turns) { var t = '', s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { t += d.step().length; s += d.own().length; } catch (e) { t += e.constructor.name[0]; } } return t.length + ' ' + s + ' ' + t.slice(0, 12); }
  function one(d, turns) { var s = ''; for (var i = 0; i < turns; i++) { try { s = d.step() + d.own() + d.n; } catch (e) { s = e.constructor.name; } } return s; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(40); });
    for (let q = 0; q < all.length; q++) say(q, function () { var d = all[q], k = []; for (var name in d) k.push(name); return one(d, 9) + ' ' + k.join() + ' ' + [d instanceof A, d instanceof B, d instanceof C, d instanceof DA, d.constructor && d.constructor.name].join(); });
    say('statics', function () { return [DA.kind, DB.kind, DC.kind, EA.kind, typeof DA.super_, typeof DB.__super__, typeof DC.superClass_, Object.keys(DA).join()].join(' '); });
    say('above', function () { return [DA, DB, DC, EA].map(function (f) { var p = Object.getPrototypeOf(f.prototype); return p === A.prototype ? 'A' : p === B.prototype ? 'B' : p === C.prototype ? 'C' : p === DA.prototype ? 'DA' : p === Object.prototype ? 'O' : 'other'; }).join(); });
  }
  fill();
  look('first');
  try { link(DA, B); link(DB, A); DA.prototype.own = DB.prototype.own = function () { return "x" + this.get(); }; fill(); } catch (e) { console.log('later', e.constructor.name); }
  look('later');
  say('fill', function () { fill(); return all.length; });
  look('last');
})();
