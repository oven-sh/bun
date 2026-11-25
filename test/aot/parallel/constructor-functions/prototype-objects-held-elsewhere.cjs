// What a helper makes for a prototype is held somewhere else too: whoever holds it calls its methods, and lays others on it.
console.log('same--owntyped');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { function F() {} F.prototype = p.prototype; var o = new F(); c.prototype = o; kept = o; }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.own = function () { return 'text'; }; var t = ''; for (var q = 0; q < 4; q++) t += all[q].own() + all[q].step(); console.log(t);
  console.log(run(40));
})();
console.log('same--callset');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { function F() {} F.prototype = p.prototype; var o = new F(); c.prototype = o; kept = o; }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.n = 'five'; kept.i = 'seven'; console.log(kept.step(), kept.get());
  console.log(run(40));
})();
console.log('ctor--steptyped');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { function F() { this.constructor = c; } F.prototype = p.prototype; var o = new F(); c.prototype = o; kept = o; }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.step = function () { return 'st'; }; var t = ''; for (var q = 0; q < 4; q++) t += all[q].own() + all[q].step(); console.log(t);
  console.log(run(40));
})();
console.log('second--callgrown');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { function F() {} F.prototype = p.prototype; c.prototype = new F(); kept = new F(); }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.a = 1; kept.b = 'x'; kept.c = {}; kept.n = { z: 1 }; kept.i = 2.5; console.log(kept.step(), kept.get().z, kept.b);
  console.log(run(40));
})();
console.log('returned--callset');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { function F() {} F.prototype = p.prototype; c.prototype = new F(); kept = new F(); return c; }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.n = 'five'; kept.i = 'seven'; console.log(kept.step(), kept.get());
  console.log(run(40));
})();
console.log('joined--gettyped');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { function F() {} F.prototype = p.prototype; var o = p === null ? Object.create(p) : new F(); c.prototype = o; kept = o; }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.get = function () { return 'g'; }; var t = ''; for (var q = 0; q < 4; q++) t += all[q].own() + all[q].step(); console.log(t);
  console.log(run(40));
})();
console.log('created--owntyped');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { var o = p === null ? Object.create(p) : Object.create(p.prototype); c.prototype = o; kept = o; }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.own = function () { return 'text'; }; var t = ''; for (var q = 0; q < 4; q++) t += all[q].own() + all[q].step(); console.log(t);
  console.log(run(40));
})();
console.log('createdsecond--callset');
(function () {
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); }
  var kept;
  function inherit(c, p) { c.prototype = Object.create(p.prototype); var o = p === null ? Object.create(p) : Object.create(p.prototype); kept = o; }
  inherit(D, B);
  D.prototype.own = function () { return this.get(); };
  var all = [new D(1), new D(2), new D(3), new D(4)];
  function run(k) { var s = 0; for (var i = 0; i < k; i++) { var d = all[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; }
  console.log(run(40));
  kept.n = 'five'; kept.i = 'seven'; console.log(kept.step(), kept.get());
  console.log(run(40));
})();
