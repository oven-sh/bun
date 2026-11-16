// A helper copies the names of the parent function onto the child: what stands on it, is read there later, or runs when it is copied, is as written.
console.log('tsplain--values--change');
try { (function () {
  var asked = [];
  var link = function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
  };
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.kind = 'b'; B.list = [1, 2]; B.count = 0;
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  B.prototype.get = function () { return 'changed'; }; D.kind = 5; report(); run(6);
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('coffee--method--relink');
try { (function () {
  var asked = [];
  var link = function (child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; }, hasProp = {}.hasOwnProperty;
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.create = function (n) { return new this(n); }; B.name2 = function () { return this.kind2 || 'none'; }; B.kind2 = 'k';
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  link(E, D); E.prototype.own = function () { return 'E' + this.get(); }; var es = [new E(1), new E(2)]; t.push(es[0].own(), es[1].step(), String(E.kind), String(E.late));
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('coffeedeclared--own--lateown');
try { (function () {
  var asked = [];
  var hasProp = Object.prototype.hasOwnProperty;
  function link(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; }
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.kind = 'b'; D.kind = 'd'; D.only = 1;
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  D.kind = 'lateown'; report();
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('tsplain--asks--plain');
try { (function () {
  var asked = [];
  var link = function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
  };
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.hasOwnProperty = function (k) { asked.push(k, this === B, typeof this.prototype.step); return k === 'kind'; }; B.kind = 'b'; B.other = 'o';
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('coffee--getter--plain');
try { (function () {
  var asked = [];
  var link = function (child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; }, hasProp = {}.hasOwnProperty;
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  Object.defineProperty(B, 'kind', { get: function () { asked.push(this === B); return 'g' + (this.prototype === B.prototype); }, enumerable: true, configurable: true });
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('tsplain--setter--late');
try { (function () {
  var asked = [];
  var link = function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
  };
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.kind = 'b'; Object.defineProperty(D, 'kind', { set: function (v) { asked.push(v, this === D); }, get: function () { return 'got'; }, configurable: true });
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  B.kind = 'late'; B.late = 'l'; report();
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('unfiltered--parentclass--plain');
try { (function () {
  var asked = [];
  function link(child, parent) { for (var key in parent) child[key] = parent[key]; child.prototype = Object.create(parent.prototype); child.prototype.constructor = child; }
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  class P { static kind() { return 'P' + typeof this; } static hasOwnProperty(k) { asked.push('P', k); return true; } } Object.setPrototypeOf(B, P); B.own = 1;
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('created--arrow--late');
try { (function () {
  var asked = [];
  function link(child, parent) { for (var key in parent) if (Object.prototype.hasOwnProperty.call(parent, key)) child[key] = parent[key]; child.prototype = Object.create(parent.prototype); child.prototype.constructor = child; }
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.make = function () { return 'made'; }; B.count = 1; B.next = function () { return ++B.count; };
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  B.kind = 'late'; B.late = 'l'; report();
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('prefixed--values--plain');
try { (function () {
  var asked = [];
  function link(child, parent) { for (var key in parent) if (parent.hasOwnProperty(key)) child['p' + key] = parent[key]; child.prototype = Object.create(parent.prototype); }
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.kind = 'b'; B.list = [1, 2]; B.count = 0;
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('leaking--method--relink');
try { (function () {
  var asked = [];
  var seen = [];
  function link(child, parent) { for (var key in parent) if (parent.hasOwnProperty(key)) { child[key] = parent[key]; seen.push(parent[key]); } child.prototype = Object.create(parent.prototype); }
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.create = function (n) { return new this(n); }; B.name2 = function () { return this.kind2 || 'none'; }; B.kind2 = 'k';
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  link(E, D); E.prototype.own = function () { return 'E' + this.get(); }; var es = [new E(1), new E(2)]; t.push(es[0].own(), es[1].step(), String(E.kind), String(E.late));
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('called--arrow--plain');
try { (function () {
  var asked = [];
  var seen = [];
  function link(child, parent) { for (var key in parent) if (parent.hasOwnProperty(key)) { child[key] = parent[key]; if (typeof parent[key] === 'function') seen.push(parent[key]()); } child.prototype = Object.create(parent.prototype); }
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.make = function () { return 'made'; }; B.count = 1; B.next = function () { return ++B.count; };
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('swapped--own--plain');
try { (function () {
  var asked = [];
  function link(child, parent) { for (var key in child) if (child.hasOwnProperty(key)) parent[key] = child[key]; child.prototype = Object.create(parent.prototype); }
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.kind = 'b'; D.kind = 'd'; D.only = 1;
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('coffee--computed--plain');
try { (function () {
  var asked = [];
  var link = function (child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; }, hasProp = {}.hasOwnProperty;
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B['ki' + 'nd'] = 'computed'; B[['x']] = 'x';
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('tsplain--self--relink');
try { (function () {
  var asked = [];
  var link = function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
  };
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.self = B; B.proto = B.prototype;
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  link(E, D); E.prototype.own = function () { return 'E' + this.get(); }; var es = [new E(1), new E(2)]; t.push(es[0].own(), es[1].step(), String(E.kind), String(E.late));
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('coffee--enumerableproto--plain');
try { (function () {
  var asked = [];
  var link = function (child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; }, hasProp = {}.hasOwnProperty;
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  Object.defineProperty(B, 'prototype', { enumerable: true }); B.kind = 'b';
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
console.log('tsplain--frozen--plain');
try { (function () {
  var asked = [];
  var link = function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
  };
  
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.d = 1; }
  function E(n) { D.call(this, n); }
  B.kind = 'b'; Object.freeze(D);
  try { link(D, B); } catch (e) { asked.push(e.name); }
  D.prototype.own = function () { return 'D' + this.get(); };
  var all = [], t = [];
  try { all = [new D(1), new D(2)]; } catch (e) { t.push(e.name); }
  function run(k) { for (var i = 0; i < k && all.length; i++) { var d = all[i & 1]; try { t.push(d.step(), d.own(), d.get(), d.n); } catch (e) { t.push(e.name); } } }
  function report() { t.push(String(D.kind), String(D.list), String(D.count), String(D.late), typeof D.create, typeof D.name2 === 'function' ? D.name2() : 'no', typeof D.next === 'function' ? D.next() : 'no', typeof D.make === 'function' ? D.make() : 'no', String(D.extra), String(D[0]), Object.keys(D).join('+')); if (typeof D.create === 'function') t.push(D.create(7).own()); }
  run(6); report();
  
  console.log(t.join('|')); console.log(asked.join('|')); if (typeof seen !== 'undefined') console.log(seen.length, typeof seen[0]);
})(); } catch (e) { console.log(e.name); }
