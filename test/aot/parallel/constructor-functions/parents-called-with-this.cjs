// What Parent.call(this, ..) fills counts as filled, unless Parent shows the object, answers with another, or is not what is called.
console.log('plain--typescript');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { var _this = B.call(this, n) || this; _this.k = n * 2; return _this; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('plain--three-typescript');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function M(n) { var _this = B.call(this, n) || this; _this.mid = 'm'; return _this; }
  M.prototype = Object.create(B.prototype);
  function D(n) { var _this = M.call(this, n) || this; _this.k = 1; return _this; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('leaks--call');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { seen.push(this); this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.k = n * 2; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('reads--call-last');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { was += typeof this.k + this.n; this.n = n; this.i = 0; was += typeof this.k; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { this.k = n * 2; B.call(this, n); }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('object--typescript');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; if (n === 3) return { n: 'other', i: 50, step: B.prototype.step, get: B.prototype.get, own: B.prototype.get }; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { var _this = B.call(this, n) || this; _this.k = n * 2; return _this; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('primitive--or-this');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; return n === 3 ? 5 : 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { return B.call(this, n) || this; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('own-call--call');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; }
  B.call = function (self, n) { self.n = 'by own call'; self.i = 3; return undefined; };
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.call(this, n); this.k = n * 2; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('plain--variable-changes');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  var P = B;
  function D(n) { if (n === 3) P = C; P.call(this, n); this.k = 1; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('late--typescript-super');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; if (n > 2) this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  var D = (function (_super) { function D(n) { var _this = _super.call(this, n) || this; _this.k = n; _this.j = _this.n; return _this; } return D; })(B);
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('virtual--apply-list');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; this.init(); }
  B.prototype.init = function () { was += 'B'; };
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { B.apply(this, [n]); this.k = 1; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('throws--try');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; if (n === 3) throw new RangeError('three'); this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { try { B.call(this, n); } catch (e) { this.error = e.constructor.name; } this.k = 1; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('plain--early-return');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  function D(n) { if (n === 2) return; B.call(this, n); this.k = 1; }
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
console.log('plain--typescript-default');
(function () {
  var seen = [], was = '';
  function note(o) { was += Object.keys(o).length; }
  function C(n) { this.n = 'C' + n; this.c = 1; }
  C.prototype.step = function () { return 0.5; };
  C.prototype.get = function () { return 'c'; };
  function B(n) { this.n = n; this.i = 0; }
  B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
  B.prototype.get = function () { return this.n; };
  var D = (function (_super) { function D() { return _super !== null && _super.apply(this, arguments) || this; } return D; })(B);
  D.prototype = Object.create(typeof M === 'function' ? M.prototype : B.prototype);
  D.prototype.constructor = D;
  D.prototype.own = function () { return this.get(); };
  D.prototype.sum = function () { return this.n + '|' + this.k + '|' + this.i; };
  var all = [];
  function fill() { for (var q = 1; q <= 4; q++) { try { all.push(new D(q)); } catch (e) { console.log('new', e.constructor.name, e.message); } } }
  function run(turns) { var s = 0, t = ''; for (var i = 0; i < turns; i++) { var d = all[i % all.length]; try { s += d.step(); var o = d.own(); if (typeof o === 'number') s += o; else t = o; t += d.n === undefined ? 'U' : ''; } catch (e) { t = e.constructor.name; } } return s + t; }
  function say(what, f) { try { console.log(what, f()); } catch (e) { console.log(what, e.constructor.name); } }
  function look(what) {
    say(what, function () { return run(60); });
    for (let q = 0; q < all.length; q++) say(q, function () { var o = all[q], k = []; for (var name in o) k.push(name); return Object.keys(o).join() + ' ' + k.join() + ' ' + JSON.stringify(o) + ' ' + ('n' in o) + Object.prototype.hasOwnProperty.call(o, 'i') + ' ' + (o.sum ? o.sum() : 'no') + ' ' + o.k + o.n + o.i; });
  }
  fill(); look('first');
  say('seen', function () { return seen.length + ' ' + was + ' ' + seen.map(function (o) { return Object.keys(o).join(); }).join(';'); });
  say('called', function () { var o = { n: 1 }; D.call(o, 9); return JSON.stringify(o); });
  say('plain', function () { var o = Object.create(D.prototype); return typeof o.n + typeof o.i + o.step() + String(o.n); });
  say('reflect', function () { var o = Reflect.construct(B, [4], D); return JSON.stringify(o) + o.own() + o.k + (o instanceof D); });
  class X extends D { constructor(n) { super(n); this.x = 'x'; } own() { return super.own() + 1; } }
  say('class', function () { var o = new X(6); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  function Y(n) { D.call(this, n); this.y = 'y'; } Y.prototype = Object.create(D.prototype);
  say('function', function () { var o = new Y(8); all.push(o); return JSON.stringify(o) + o.own() + o.step(); });
  look('second');
  say('delete', function () { delete all[1].n; return all[1].own() + JSON.stringify(all[1]); });
  say('setter', function () { Object.defineProperty(D.prototype, 'n', { get() { return 77; }, set(v) { was += 's' + v; }, configurable: true }); fill(); return was; });
  look('third');
  say('undone', function () { delete D.prototype.n; fill(); return all.length; });
  look('last');
})();
