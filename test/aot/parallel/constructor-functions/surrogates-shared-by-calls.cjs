// All calls of a helper link through one empty function: whoever else makes objects by it, reads or lays its prototype, or lets the helper run again in between, is right.
console.log('declared--none');
try { (function (module) {
  function F() {}
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('vardeclared--late');
try { (function (module) {
  var F = function () {};
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F(); y.prototype.constructor = y; y.uber = w.prototype; return y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  function L(n) { A.call(this, n); } link(L, B); L.prototype.own = function () { return 'L' + this.get(); }; var l = new L(1); console.log(typeof l.own, l instanceof B, l instanceof A); try { console.log(l.own(), l.step()); } catch (e) { console.log(e.name); }
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('iife--relink');
try { (function (module) {
  var link = (function () { var F = function () {}; return function (y, w) { F.prototype = w.prototype; y.prototype = new F(); y.uber = w.prototype; y.prototype.constructor = y; }; })();
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  link(DA, B); var d = new DA(1); console.log(d instanceof B, typeof d.own);
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('member--change');
try { (function (module) {
  var Box = {};
  (function (a) { function F() {} a.inherit = function (y, w) { var t = y; F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = t; }; })(Box);
  function link(y, w) { Box.inherit(y, w); }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  A.prototype.get = function () { return 'A'; }; B.prototype.step = function () { return 'B'; };
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('temp--relinklater');
try { (function (module) {
  function F() {}
  function link(y, w) { var t = y; F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = t; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  link(EA, B); EA.prototype.own = function () { return 'EB' + this.get(); }; console.log(run(make(), 10));
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('between--none');
try { (function (module) {
  function F() {}
  var depth = 0;
  function other() { if (depth++ === 1) { F.prototype = B.prototype; } }
  function link(y, w) { F.prototype = w.prototype; other(); y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('reentrant--hook');
try { (function (module) {
  function F() {}
  var hook = null;
  function link(y, w) { F.prototype = w.prototype; if (hook) { var h = hook; hook = null; h(); } y.prototype = new F; y.prototype.constructor = y; }
  function relinkDB() { link(DB, B); DB.prototype.own = function () { return 'DB' + this.get(); }; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  hook = relinkDB; link(EA, DA); EA.prototype.own = function () { return 'EA' + this.get(); }; console.log(new EA(1) instanceof A, new EA(1) instanceof B, new DB(1) instanceof B); console.log(run(make(), 10));
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('reentrantcall--none');
try { (function (module) {
  function F() {}
  var turns = 0;
  function Z(n) { this.n = 'z' + n; this.i = 'z'; }
  Z.prototype.step = function () { return this.i + 'z'; };
  Z.prototype.get = function () { return { z: this.n }; };
  function DZ(n) { Z.call(this, n); }
  function hook() { if (turns++ === 0) link(DZ, Z); }
  function link(y, w) { F.prototype = w.prototype; hook(); y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('twohelpers--late');
try { (function (module) {
  function F() {}
  function link(y, w) { if (w === B) return linkB(y, w); F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function linkB(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  function L(n) { A.call(this, n); } link(L, B); L.prototype.own = function () { return 'L' + this.get(); }; var l = new L(1); console.log(typeof l.own, l instanceof B, l instanceof A); try { console.log(l.own(), l.step()); } catch (e) { console.log(e.name); }
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('secondkept--kept');
try { (function (module) {
  var kept;
  function F() {}
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; kept = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  kept.n = 'k'; kept.i = {}; kept.m = 5; kept.j = 'q'; console.log(kept.step(), kept.get());
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('declared--make');
try { (function (module) {
  function F() {}
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  var o = new F(); console.log(typeof o.step); o.n = 'x'; o.i = 'y'; o.m = 1; o.j = 'z'; console.log(o.step(), o.get());
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('declared--read');
try { (function (module) {
  function F() {}
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  console.log(F.prototype === DA.prototype, F.prototype === A.prototype); F.prototype.get = function () { return 'changed'; };
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('var--store');
try { (function (module) {
  var F = function () {};
  var link = function (y, w) { F.prototype = w.prototype; y.prototype = new F(); y.prototype.constructor = y; y.uber = w.prototype; return y; };
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  F.prototype = { step: function () { return 's'; } }; console.log(typeof new F().step);
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('exported--exportread');
try { (function (module) {
  function F() {}
  module.exports.F = F;
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  var G = module.exports.F; var g = new G(); g.n = 'g'; g.i = 'h'; console.log(g.step(), g.get());
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('evaled--evallink');
try { (function (module) {
  var kept2;
  function F() {}
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function look(text) { return eval(text); }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  look('F.prototype = A.prototype, kept2 = new F()'); console.log(kept2.step(), kept2.get());
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('reassigned--swap');
try { (function (module) {
  var F = function () {};
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function swap() { F = function () { this.swapped = 1; }; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  swap(); link(DB, A); console.log(new DB(1) instanceof A, new DB(1).swapped);
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('conditional--none');
try { (function (module) {
  function F() {}
  function link(y, w) { if (w) F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('twice--late');
try { (function (module) {
  function F() {}
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; F.prototype = A.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  function L(n) { A.call(this, n); } link(L, B); L.prototype.own = function () { return 'L' + this.get(); }; var l = new L(1); console.log(typeof l.own, l instanceof B, l instanceof A); try { console.log(l.own(), l.step()); } catch (e) { console.log(e.name); }
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('filled--own');
try { (function (module) {
  function F() { this.filled = 'f'; }
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
  try {
  DA.prototype.step = function () { return 'own'; }; DB.prototype.get = function () { return { toString: function () { return 'o'; } }; };
  } catch (e) { console.log(e.name); }
  console.log(run(all, 10)); console.log(runA(ofA, 20)); console.log(run(make(), 10));
})({ exports: {} }); } catch (e) { console.log(e.name); }
console.log('returned--none');
try { (function (module) {
  function F() { return made; }
  var made = { odd: 1 };
  function link(y, w) { F.prototype = w.prototype; y.prototype = new F; y.prototype.constructor = y; }
  function A(n) { this.n = n; this.i = 0; }
  A.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  A.prototype.get = function () { return this.n; };
  function B(n) { this.m = 'b' + n; this.j = 0.5; }
  B.prototype.step = function () { this.j = this.j + 1; return this.j; };
  B.prototype.get = function () { return this.m; };
  function DA(n) { A.call(this, n); this.da = n; }
  function DB(n) { B.call(this, n); this.db = n; }
  function EA(n) { DA.call(this, n); this.ea = n; }
  link(DA, A);
  DA.prototype.own = function () { return 'DA' + this.get(); };
  link(DB, B);
  DB.prototype.own = function () { return 'DB' + this.get(); };
  link(EA, DA);
  EA.prototype.own = function () { return 'EA' + this.get(); };
  function make() { return [new DA(1), new DB(2), new EA(3), new DA(4), new DB(5)]; }
  function run(all, turns) { var t = [], s = 0; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; t.push(d.step(), d.own()); s += d.step(); } return t.join() + ' ' + s; }
  function runA(all, turns) { var s = 0; for (var i = 0; i < turns; i++) { var d = all[i & 1]; s = (s + d.step() + d.get()) | 0; } return s; }
  var all = make(), ofA = [new DA(7), new EA(8)];
  console.log(run(all, 10)); console.log(runA(ofA, 20));
})({ exports: {} }); } catch (e) { console.log(e.name); }
