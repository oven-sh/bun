// `o.m()` in a loop, below constructor functions: `C.prototype.own = function ..`, `C.prototype = Object.create(A.prototype)`. What the statements laid under the name is called directly only while it still lies there, nothing hides it
// and the object still stands below its function's prototype object. Each change has functions of its own for each shape of site. Every call stands in a loop, where the guarded call is built. Written by a generator: the text is the test.
let log = '', calls = 0;
const sink = []; globalThis.sinkOfOldMethods = sink;
function escape(o) { sink.push(o); sink.length = 0; }
const nameOfOwn = ['o', 'w', 'n'].join(''), nameOfM = String.fromCharCode(109);
function attempt(run) { log = ''; calls = 0; try { return run() + ' [' + log + calls + ']'; } catch (e) { return (e instanceof TypeError ? 'TypeError' : 'other ' + e) + ' [' + log + calls + ']'; } }
const hooks = [
  (o, own, above) => { },
  (o, own, above) => { own.own = function (x) { return 'assigned own' + x; }; },
  (o, own, above) => { above.m = function (x) { return 'assigned m' + x; }; },
  (o, own, above) => { own.m = function (x) { return 'added m' + x; }; },
  (o, own, above) => { Object.defineProperty(own, 'own', { get() { log += 'g'; return (x) => 'getter own' + x; }, configurable: true }); },
  (o, own, above) => { Object.defineProperty(above, 'm', { get() { log += 'G'; return (x) => 'getter m' + x; }, configurable: true }); },
  (o, own, above) => { Object.defineProperty(own, 'm', { get() { log += 'h'; return (x) => 'getter between' + x; }, configurable: true }); },
  (o, own, above) => { delete own.own; },
  (o, own, above) => { delete above.m; },
  (o, own, above) => { o.own = (x) => 'instance own' + x; },
  (o, own, above) => { o.m = (x) => 'instance m' + x; },
  (o, own, above) => { Object.defineProperty(o, 'own', { value: (x) => 'defined own' + x, configurable: true }); },
  (o, own, above) => { Object.defineProperty(o, 'm', { get() { log += 'i'; return (x) => 'instance getter m' + x; }, configurable: true }); },
  (o, own, above) => { Object.assign(o, { own: (x) => 'copied own' + x, m: (x) => 'copied m' + x }); },
  (o, own, above) => { o[nameOfOwn] = (x) => 'computed own' + x; o[nameOfM] = (x) => 'computed m' + x; },
  (o, own, above) => { own[nameOfOwn] = (x) => 'computed on class' + x; },
  (o, own, above) => { above[nameOfM] = (x) => 'computed above' + x; },
  (o, own, above) => { Object.setPrototypeOf(o, { own(x) { return 'other own' + x; }, m(x) { return 'other m' + x; } }); },
  (o, own, above) => { Object.setPrototypeOf(o, null); },
  (o, own, above) => { Object.setPrototypeOf(o, Object.create(own)); },
  (o, own, above) => { Object.setPrototypeOf(o, Object.create(own, { m: { value: (x) => 'hidden m' + x } })); },
  (o, own, above) => { Object.setPrototypeOf(o, above); },
  (o, own, above) => { o.__proto__ = { own: (x) => 'proto own' + x, m: (x) => 'proto m' + x }; },
  (o, own, above) => { Object.setPrototypeOf(own, { m(x) { return 'other parent m' + x; } }); },
  (o, own, above) => { Object.setPrototypeOf(own, null); },
  (o, own, above) => { own.__proto__ = { m: (x) => 'proto parent m' + x }; },
  (o, own, above) => { Object.setPrototypeOf(above, { own() { return 'never'; }, m() { return 'never'; } }); },
  (o, own, above) => { Reflect.set(own, 'own', (x) => 'reflected own' + x); },
  (o, own, above) => { Reflect.defineProperty(above, 'm', { value: (x) => 'reflected m' + x }); },
  (o, own, above) => { own.own = own.own; above.m = above.m; },
  (o, own, above) => { Object.freeze(own); Object.freeze(above); },
  (o, own, above) => { own.own = 5; },
  (o, own, above) => { above.m = undefined; },
  (o, own, above) => { Object.defineProperty(own, 'own', { value: (x) => 'read only own' + x, writable: false }); },
  (o, own, above) => { const other = Object.create(own); other.own = () => 'of another'; other.m = () => 'of another'; },
  (o, own, above) => { o.own = () => 'gone'; delete o.own; o.m = () => 'gone'; delete o.m; },
  (o, own, above) => { const was = own.own; own.own = () => 'gone'; own.own = was; },
  (o, own, above) => { own.own = own.own.bind({ v: 'bound' }); },
  (o, own, above) => { Object.freeze(o); },
  (o, own, above) => { o.other = 1; o.more = 2; delete o.v; },
];
function A0t() { }
A0t.prototype.m = function (x) { calls++; return 'A0t.m' + x; };
function C0t() { this.v = 0; }
C0t.prototype = Object.create(A0t.prototype);
C0t.prototype.constructor = C0t;
C0t.prototype.own = function (x) { calls++; return 'C0t.own' + x + this.v; };
function make0t() { const o = new C0t(); escape(o); return o; }
function run0t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C0t.prototype, A0t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A0l() { }
A0l.prototype.m = function (x) { calls++; return 'A0l.m' + x; };
function C0l() { this.v = 0; }
C0l.prototype = Object.create(A0l.prototype);
C0l.prototype.constructor = C0l;
C0l.prototype.own = function (x) { calls++; return 'C0l.own' + x + this.v; };
function make0l() { const o = new C0l(); escape(o); return o; }
function run0l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C0l.prototype, A0l.prototype); s += o.m(i) + ';'; } return s; }
function A0f() { }
A0f.prototype.m = function (x) { calls++; return 'A0f.m' + x; };
function C0f() { this.v = 0; }
C0f.prototype = Object.create(A0f.prototype);
C0f.prototype.constructor = C0f;
C0f.prototype.own = function (x) { calls++; return 'C0f.own' + x + this.v; };
function make0f() { const o = new C0f(); escape(o); return o; }
function call0f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run0f(o, hook) { hook(o, C0f.prototype, A0f.prototype); return call0f(o); }
function A0a() { }
A0a.prototype.m = function (x) { calls++; return 'A0a.m' + x; };
function C0a() { this.v = 0; }
C0a.prototype = Object.create(A0a.prototype);
C0a.prototype.constructor = C0a;
C0a.prototype.own = function (x) { calls++; return 'C0a.own' + x + this.v; };
function make0a() { const o = new C0a(); escape(o); return o; }
function call0a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run0a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call0a(o); hook(o, C0a.prototype, A0a.prototype); return s + '|' + call0a(o) + '|' + call0a(make0a()); }
function A1t() { }
A1t.prototype.m = function (x) { calls++; return 'A1t.m' + x; };
function C1t() { this.v = 1; }
C1t.prototype = Object.create(A1t.prototype);
C1t.prototype.constructor = C1t;
C1t.prototype.own = function (x) { calls++; return 'C1t.own' + x + this.v; };
function make1t() { const o = new C1t(); escape(o); return o; }
function run1t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C1t.prototype, A1t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A1l() { }
A1l.prototype.m = function (x) { calls++; return 'A1l.m' + x; };
function C1l() { this.v = 1; }
C1l.prototype = Object.create(A1l.prototype);
C1l.prototype.constructor = C1l;
C1l.prototype.own = function (x) { calls++; return 'C1l.own' + x + this.v; };
function make1l() { const o = new C1l(); escape(o); return o; }
function run1l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C1l.prototype, A1l.prototype); s += o.m(i) + ';'; } return s; }
function A1f() { }
A1f.prototype.m = function (x) { calls++; return 'A1f.m' + x; };
function C1f() { this.v = 1; }
C1f.prototype = Object.create(A1f.prototype);
C1f.prototype.constructor = C1f;
C1f.prototype.own = function (x) { calls++; return 'C1f.own' + x + this.v; };
function make1f() { const o = new C1f(); escape(o); return o; }
function call1f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run1f(o, hook) { hook(o, C1f.prototype, A1f.prototype); return call1f(o); }
function A1a() { }
A1a.prototype.m = function (x) { calls++; return 'A1a.m' + x; };
function C1a() { this.v = 1; }
C1a.prototype = Object.create(A1a.prototype);
C1a.prototype.constructor = C1a;
C1a.prototype.own = function (x) { calls++; return 'C1a.own' + x + this.v; };
function make1a() { const o = new C1a(); escape(o); return o; }
function call1a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run1a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call1a(o); hook(o, C1a.prototype, A1a.prototype); return s + '|' + call1a(o) + '|' + call1a(make1a()); }
function A2t() { }
A2t.prototype.m = function (x) { calls++; return 'A2t.m' + x; };
function C2t() { this.v = 2; }
C2t.prototype = Object.create(A2t.prototype);
C2t.prototype.constructor = C2t;
C2t.prototype.own = function (x) { calls++; return 'C2t.own' + x + this.v; };
function make2t() { const o = new C2t(); escape(o); return o; }
function run2t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C2t.prototype, A2t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A2l() { }
A2l.prototype.m = function (x) { calls++; return 'A2l.m' + x; };
function C2l() { this.v = 2; }
C2l.prototype = Object.create(A2l.prototype);
C2l.prototype.constructor = C2l;
C2l.prototype.own = function (x) { calls++; return 'C2l.own' + x + this.v; };
function make2l() { const o = new C2l(); escape(o); return o; }
function run2l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C2l.prototype, A2l.prototype); s += o.m(i) + ';'; } return s; }
function A2f() { }
A2f.prototype.m = function (x) { calls++; return 'A2f.m' + x; };
function C2f() { this.v = 2; }
C2f.prototype = Object.create(A2f.prototype);
C2f.prototype.constructor = C2f;
C2f.prototype.own = function (x) { calls++; return 'C2f.own' + x + this.v; };
function make2f() { const o = new C2f(); escape(o); return o; }
function call2f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run2f(o, hook) { hook(o, C2f.prototype, A2f.prototype); return call2f(o); }
function A2a() { }
A2a.prototype.m = function (x) { calls++; return 'A2a.m' + x; };
function C2a() { this.v = 2; }
C2a.prototype = Object.create(A2a.prototype);
C2a.prototype.constructor = C2a;
C2a.prototype.own = function (x) { calls++; return 'C2a.own' + x + this.v; };
function make2a() { const o = new C2a(); escape(o); return o; }
function call2a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run2a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call2a(o); hook(o, C2a.prototype, A2a.prototype); return s + '|' + call2a(o) + '|' + call2a(make2a()); }
function A3t() { }
A3t.prototype.m = function (x) { calls++; return 'A3t.m' + x; };
function C3t() { this.v = 3; }
C3t.prototype = Object.create(A3t.prototype);
C3t.prototype.constructor = C3t;
C3t.prototype.own = function (x) { calls++; return 'C3t.own' + x + this.v; };
function make3t() { const o = new C3t(); escape(o); return o; }
function run3t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C3t.prototype, A3t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A3l() { }
A3l.prototype.m = function (x) { calls++; return 'A3l.m' + x; };
function C3l() { this.v = 3; }
C3l.prototype = Object.create(A3l.prototype);
C3l.prototype.constructor = C3l;
C3l.prototype.own = function (x) { calls++; return 'C3l.own' + x + this.v; };
function make3l() { const o = new C3l(); escape(o); return o; }
function run3l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C3l.prototype, A3l.prototype); s += o.m(i) + ';'; } return s; }
function A3f() { }
A3f.prototype.m = function (x) { calls++; return 'A3f.m' + x; };
function C3f() { this.v = 3; }
C3f.prototype = Object.create(A3f.prototype);
C3f.prototype.constructor = C3f;
C3f.prototype.own = function (x) { calls++; return 'C3f.own' + x + this.v; };
function make3f() { const o = new C3f(); escape(o); return o; }
function call3f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run3f(o, hook) { hook(o, C3f.prototype, A3f.prototype); return call3f(o); }
function A3a() { }
A3a.prototype.m = function (x) { calls++; return 'A3a.m' + x; };
function C3a() { this.v = 3; }
C3a.prototype = Object.create(A3a.prototype);
C3a.prototype.constructor = C3a;
C3a.prototype.own = function (x) { calls++; return 'C3a.own' + x + this.v; };
function make3a() { const o = new C3a(); escape(o); return o; }
function call3a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run3a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call3a(o); hook(o, C3a.prototype, A3a.prototype); return s + '|' + call3a(o) + '|' + call3a(make3a()); }
function A4t() { }
A4t.prototype.m = function (x) { calls++; return 'A4t.m' + x; };
function C4t() { this.v = 4; }
C4t.prototype = Object.create(A4t.prototype);
C4t.prototype.constructor = C4t;
C4t.prototype.own = function (x) { calls++; return 'C4t.own' + x + this.v; };
function make4t() { const o = new C4t(); escape(o); return o; }
function run4t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C4t.prototype, A4t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A4l() { }
A4l.prototype.m = function (x) { calls++; return 'A4l.m' + x; };
function C4l() { this.v = 4; }
C4l.prototype = Object.create(A4l.prototype);
C4l.prototype.constructor = C4l;
C4l.prototype.own = function (x) { calls++; return 'C4l.own' + x + this.v; };
function make4l() { const o = new C4l(); escape(o); return o; }
function run4l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C4l.prototype, A4l.prototype); s += o.m(i) + ';'; } return s; }
function A4f() { }
A4f.prototype.m = function (x) { calls++; return 'A4f.m' + x; };
function C4f() { this.v = 4; }
C4f.prototype = Object.create(A4f.prototype);
C4f.prototype.constructor = C4f;
C4f.prototype.own = function (x) { calls++; return 'C4f.own' + x + this.v; };
function make4f() { const o = new C4f(); escape(o); return o; }
function call4f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run4f(o, hook) { hook(o, C4f.prototype, A4f.prototype); return call4f(o); }
function A4a() { }
A4a.prototype.m = function (x) { calls++; return 'A4a.m' + x; };
function C4a() { this.v = 4; }
C4a.prototype = Object.create(A4a.prototype);
C4a.prototype.constructor = C4a;
C4a.prototype.own = function (x) { calls++; return 'C4a.own' + x + this.v; };
function make4a() { const o = new C4a(); escape(o); return o; }
function call4a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run4a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call4a(o); hook(o, C4a.prototype, A4a.prototype); return s + '|' + call4a(o) + '|' + call4a(make4a()); }
function A5t() { }
A5t.prototype.m = function (x) { calls++; return 'A5t.m' + x; };
function C5t() { this.v = 5; }
C5t.prototype = Object.create(A5t.prototype);
C5t.prototype.constructor = C5t;
C5t.prototype.own = function (x) { calls++; return 'C5t.own' + x + this.v; };
function make5t() { const o = new C5t(); escape(o); return o; }
function run5t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C5t.prototype, A5t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A5l() { }
A5l.prototype.m = function (x) { calls++; return 'A5l.m' + x; };
function C5l() { this.v = 5; }
C5l.prototype = Object.create(A5l.prototype);
C5l.prototype.constructor = C5l;
C5l.prototype.own = function (x) { calls++; return 'C5l.own' + x + this.v; };
function make5l() { const o = new C5l(); escape(o); return o; }
function run5l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C5l.prototype, A5l.prototype); s += o.m(i) + ';'; } return s; }
function A5f() { }
A5f.prototype.m = function (x) { calls++; return 'A5f.m' + x; };
function C5f() { this.v = 5; }
C5f.prototype = Object.create(A5f.prototype);
C5f.prototype.constructor = C5f;
C5f.prototype.own = function (x) { calls++; return 'C5f.own' + x + this.v; };
function make5f() { const o = new C5f(); escape(o); return o; }
function call5f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run5f(o, hook) { hook(o, C5f.prototype, A5f.prototype); return call5f(o); }
function A5a() { }
A5a.prototype.m = function (x) { calls++; return 'A5a.m' + x; };
function C5a() { this.v = 5; }
C5a.prototype = Object.create(A5a.prototype);
C5a.prototype.constructor = C5a;
C5a.prototype.own = function (x) { calls++; return 'C5a.own' + x + this.v; };
function make5a() { const o = new C5a(); escape(o); return o; }
function call5a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run5a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call5a(o); hook(o, C5a.prototype, A5a.prototype); return s + '|' + call5a(o) + '|' + call5a(make5a()); }
function A6t() { }
A6t.prototype.m = function (x) { calls++; return 'A6t.m' + x; };
function C6t() { this.v = 6; }
C6t.prototype = Object.create(A6t.prototype);
C6t.prototype.constructor = C6t;
C6t.prototype.own = function (x) { calls++; return 'C6t.own' + x + this.v; };
function make6t() { const o = new C6t(); escape(o); return o; }
function run6t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C6t.prototype, A6t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A6l() { }
A6l.prototype.m = function (x) { calls++; return 'A6l.m' + x; };
function C6l() { this.v = 6; }
C6l.prototype = Object.create(A6l.prototype);
C6l.prototype.constructor = C6l;
C6l.prototype.own = function (x) { calls++; return 'C6l.own' + x + this.v; };
function make6l() { const o = new C6l(); escape(o); return o; }
function run6l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C6l.prototype, A6l.prototype); s += o.m(i) + ';'; } return s; }
function A6f() { }
A6f.prototype.m = function (x) { calls++; return 'A6f.m' + x; };
function C6f() { this.v = 6; }
C6f.prototype = Object.create(A6f.prototype);
C6f.prototype.constructor = C6f;
C6f.prototype.own = function (x) { calls++; return 'C6f.own' + x + this.v; };
function make6f() { const o = new C6f(); escape(o); return o; }
function call6f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run6f(o, hook) { hook(o, C6f.prototype, A6f.prototype); return call6f(o); }
function A6a() { }
A6a.prototype.m = function (x) { calls++; return 'A6a.m' + x; };
function C6a() { this.v = 6; }
C6a.prototype = Object.create(A6a.prototype);
C6a.prototype.constructor = C6a;
C6a.prototype.own = function (x) { calls++; return 'C6a.own' + x + this.v; };
function make6a() { const o = new C6a(); escape(o); return o; }
function call6a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run6a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call6a(o); hook(o, C6a.prototype, A6a.prototype); return s + '|' + call6a(o) + '|' + call6a(make6a()); }
function A7t() { }
A7t.prototype.m = function (x) { calls++; return 'A7t.m' + x; };
function C7t() { this.v = 7; }
C7t.prototype = Object.create(A7t.prototype);
C7t.prototype.constructor = C7t;
C7t.prototype.own = function (x) { calls++; return 'C7t.own' + x + this.v; };
function make7t() { const o = new C7t(); escape(o); return o; }
function run7t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C7t.prototype, A7t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A7l() { }
A7l.prototype.m = function (x) { calls++; return 'A7l.m' + x; };
function C7l() { this.v = 7; }
C7l.prototype = Object.create(A7l.prototype);
C7l.prototype.constructor = C7l;
C7l.prototype.own = function (x) { calls++; return 'C7l.own' + x + this.v; };
function make7l() { const o = new C7l(); escape(o); return o; }
function run7l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C7l.prototype, A7l.prototype); s += o.m(i) + ';'; } return s; }
function A7f() { }
A7f.prototype.m = function (x) { calls++; return 'A7f.m' + x; };
function C7f() { this.v = 7; }
C7f.prototype = Object.create(A7f.prototype);
C7f.prototype.constructor = C7f;
C7f.prototype.own = function (x) { calls++; return 'C7f.own' + x + this.v; };
function make7f() { const o = new C7f(); escape(o); return o; }
function call7f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run7f(o, hook) { hook(o, C7f.prototype, A7f.prototype); return call7f(o); }
function A7a() { }
A7a.prototype.m = function (x) { calls++; return 'A7a.m' + x; };
function C7a() { this.v = 7; }
C7a.prototype = Object.create(A7a.prototype);
C7a.prototype.constructor = C7a;
C7a.prototype.own = function (x) { calls++; return 'C7a.own' + x + this.v; };
function make7a() { const o = new C7a(); escape(o); return o; }
function call7a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run7a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call7a(o); hook(o, C7a.prototype, A7a.prototype); return s + '|' + call7a(o) + '|' + call7a(make7a()); }
function A8t() { }
A8t.prototype.m = function (x) { calls++; return 'A8t.m' + x; };
function C8t() { this.v = 8; }
C8t.prototype = Object.create(A8t.prototype);
C8t.prototype.constructor = C8t;
C8t.prototype.own = function (x) { calls++; return 'C8t.own' + x + this.v; };
function make8t() { const o = new C8t(); escape(o); return o; }
function run8t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C8t.prototype, A8t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A8l() { }
A8l.prototype.m = function (x) { calls++; return 'A8l.m' + x; };
function C8l() { this.v = 8; }
C8l.prototype = Object.create(A8l.prototype);
C8l.prototype.constructor = C8l;
C8l.prototype.own = function (x) { calls++; return 'C8l.own' + x + this.v; };
function make8l() { const o = new C8l(); escape(o); return o; }
function run8l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C8l.prototype, A8l.prototype); s += o.m(i) + ';'; } return s; }
function A8f() { }
A8f.prototype.m = function (x) { calls++; return 'A8f.m' + x; };
function C8f() { this.v = 8; }
C8f.prototype = Object.create(A8f.prototype);
C8f.prototype.constructor = C8f;
C8f.prototype.own = function (x) { calls++; return 'C8f.own' + x + this.v; };
function make8f() { const o = new C8f(); escape(o); return o; }
function call8f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run8f(o, hook) { hook(o, C8f.prototype, A8f.prototype); return call8f(o); }
function A8a() { }
A8a.prototype.m = function (x) { calls++; return 'A8a.m' + x; };
function C8a() { this.v = 8; }
C8a.prototype = Object.create(A8a.prototype);
C8a.prototype.constructor = C8a;
C8a.prototype.own = function (x) { calls++; return 'C8a.own' + x + this.v; };
function make8a() { const o = new C8a(); escape(o); return o; }
function call8a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run8a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call8a(o); hook(o, C8a.prototype, A8a.prototype); return s + '|' + call8a(o) + '|' + call8a(make8a()); }
function A9t() { }
A9t.prototype.m = function (x) { calls++; return 'A9t.m' + x; };
function C9t() { this.v = 9; }
C9t.prototype = Object.create(A9t.prototype);
C9t.prototype.constructor = C9t;
C9t.prototype.own = function (x) { calls++; return 'C9t.own' + x + this.v; };
function make9t() { const o = new C9t(); escape(o); return o; }
function run9t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C9t.prototype, A9t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A9l() { }
A9l.prototype.m = function (x) { calls++; return 'A9l.m' + x; };
function C9l() { this.v = 9; }
C9l.prototype = Object.create(A9l.prototype);
C9l.prototype.constructor = C9l;
C9l.prototype.own = function (x) { calls++; return 'C9l.own' + x + this.v; };
function make9l() { const o = new C9l(); escape(o); return o; }
function run9l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C9l.prototype, A9l.prototype); s += o.m(i) + ';'; } return s; }
function A9f() { }
A9f.prototype.m = function (x) { calls++; return 'A9f.m' + x; };
function C9f() { this.v = 9; }
C9f.prototype = Object.create(A9f.prototype);
C9f.prototype.constructor = C9f;
C9f.prototype.own = function (x) { calls++; return 'C9f.own' + x + this.v; };
function make9f() { const o = new C9f(); escape(o); return o; }
function call9f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run9f(o, hook) { hook(o, C9f.prototype, A9f.prototype); return call9f(o); }
function A9a() { }
A9a.prototype.m = function (x) { calls++; return 'A9a.m' + x; };
function C9a() { this.v = 9; }
C9a.prototype = Object.create(A9a.prototype);
C9a.prototype.constructor = C9a;
C9a.prototype.own = function (x) { calls++; return 'C9a.own' + x + this.v; };
function make9a() { const o = new C9a(); escape(o); return o; }
function call9a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run9a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call9a(o); hook(o, C9a.prototype, A9a.prototype); return s + '|' + call9a(o) + '|' + call9a(make9a()); }
function A10t() { }
A10t.prototype.m = function (x) { calls++; return 'A10t.m' + x; };
function C10t() { this.v = 10; }
C10t.prototype = Object.create(A10t.prototype);
C10t.prototype.constructor = C10t;
C10t.prototype.own = function (x) { calls++; return 'C10t.own' + x + this.v; };
function make10t() { const o = new C10t(); escape(o); return o; }
function run10t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C10t.prototype, A10t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A10l() { }
A10l.prototype.m = function (x) { calls++; return 'A10l.m' + x; };
function C10l() { this.v = 10; }
C10l.prototype = Object.create(A10l.prototype);
C10l.prototype.constructor = C10l;
C10l.prototype.own = function (x) { calls++; return 'C10l.own' + x + this.v; };
function make10l() { const o = new C10l(); escape(o); return o; }
function run10l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C10l.prototype, A10l.prototype); s += o.m(i) + ';'; } return s; }
function A10f() { }
A10f.prototype.m = function (x) { calls++; return 'A10f.m' + x; };
function C10f() { this.v = 10; }
C10f.prototype = Object.create(A10f.prototype);
C10f.prototype.constructor = C10f;
C10f.prototype.own = function (x) { calls++; return 'C10f.own' + x + this.v; };
function make10f() { const o = new C10f(); escape(o); return o; }
function call10f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run10f(o, hook) { hook(o, C10f.prototype, A10f.prototype); return call10f(o); }
function A10a() { }
A10a.prototype.m = function (x) { calls++; return 'A10a.m' + x; };
function C10a() { this.v = 10; }
C10a.prototype = Object.create(A10a.prototype);
C10a.prototype.constructor = C10a;
C10a.prototype.own = function (x) { calls++; return 'C10a.own' + x + this.v; };
function make10a() { const o = new C10a(); escape(o); return o; }
function call10a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run10a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call10a(o); hook(o, C10a.prototype, A10a.prototype); return s + '|' + call10a(o) + '|' + call10a(make10a()); }
function A11t() { }
A11t.prototype.m = function (x) { calls++; return 'A11t.m' + x; };
function C11t() { this.v = 11; }
C11t.prototype = Object.create(A11t.prototype);
C11t.prototype.constructor = C11t;
C11t.prototype.own = function (x) { calls++; return 'C11t.own' + x + this.v; };
function make11t() { const o = new C11t(); escape(o); return o; }
function run11t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C11t.prototype, A11t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A11l() { }
A11l.prototype.m = function (x) { calls++; return 'A11l.m' + x; };
function C11l() { this.v = 11; }
C11l.prototype = Object.create(A11l.prototype);
C11l.prototype.constructor = C11l;
C11l.prototype.own = function (x) { calls++; return 'C11l.own' + x + this.v; };
function make11l() { const o = new C11l(); escape(o); return o; }
function run11l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C11l.prototype, A11l.prototype); s += o.m(i) + ';'; } return s; }
function A11f() { }
A11f.prototype.m = function (x) { calls++; return 'A11f.m' + x; };
function C11f() { this.v = 11; }
C11f.prototype = Object.create(A11f.prototype);
C11f.prototype.constructor = C11f;
C11f.prototype.own = function (x) { calls++; return 'C11f.own' + x + this.v; };
function make11f() { const o = new C11f(); escape(o); return o; }
function call11f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run11f(o, hook) { hook(o, C11f.prototype, A11f.prototype); return call11f(o); }
function A11a() { }
A11a.prototype.m = function (x) { calls++; return 'A11a.m' + x; };
function C11a() { this.v = 11; }
C11a.prototype = Object.create(A11a.prototype);
C11a.prototype.constructor = C11a;
C11a.prototype.own = function (x) { calls++; return 'C11a.own' + x + this.v; };
function make11a() { const o = new C11a(); escape(o); return o; }
function call11a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run11a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call11a(o); hook(o, C11a.prototype, A11a.prototype); return s + '|' + call11a(o) + '|' + call11a(make11a()); }
function A12t() { }
A12t.prototype.m = function (x) { calls++; return 'A12t.m' + x; };
function C12t() { this.v = 12; }
C12t.prototype = Object.create(A12t.prototype);
C12t.prototype.constructor = C12t;
C12t.prototype.own = function (x) { calls++; return 'C12t.own' + x + this.v; };
function make12t() { const o = new C12t(); escape(o); return o; }
function run12t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C12t.prototype, A12t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A12l() { }
A12l.prototype.m = function (x) { calls++; return 'A12l.m' + x; };
function C12l() { this.v = 12; }
C12l.prototype = Object.create(A12l.prototype);
C12l.prototype.constructor = C12l;
C12l.prototype.own = function (x) { calls++; return 'C12l.own' + x + this.v; };
function make12l() { const o = new C12l(); escape(o); return o; }
function run12l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C12l.prototype, A12l.prototype); s += o.m(i) + ';'; } return s; }
function A12f() { }
A12f.prototype.m = function (x) { calls++; return 'A12f.m' + x; };
function C12f() { this.v = 12; }
C12f.prototype = Object.create(A12f.prototype);
C12f.prototype.constructor = C12f;
C12f.prototype.own = function (x) { calls++; return 'C12f.own' + x + this.v; };
function make12f() { const o = new C12f(); escape(o); return o; }
function call12f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run12f(o, hook) { hook(o, C12f.prototype, A12f.prototype); return call12f(o); }
function A12a() { }
A12a.prototype.m = function (x) { calls++; return 'A12a.m' + x; };
function C12a() { this.v = 12; }
C12a.prototype = Object.create(A12a.prototype);
C12a.prototype.constructor = C12a;
C12a.prototype.own = function (x) { calls++; return 'C12a.own' + x + this.v; };
function make12a() { const o = new C12a(); escape(o); return o; }
function call12a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run12a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call12a(o); hook(o, C12a.prototype, A12a.prototype); return s + '|' + call12a(o) + '|' + call12a(make12a()); }
function A13t() { }
A13t.prototype.m = function (x) { calls++; return 'A13t.m' + x; };
function C13t() { this.v = 13; }
C13t.prototype = Object.create(A13t.prototype);
C13t.prototype.constructor = C13t;
C13t.prototype.own = function (x) { calls++; return 'C13t.own' + x + this.v; };
function make13t() { const o = new C13t(); escape(o); return o; }
function run13t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C13t.prototype, A13t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A13l() { }
A13l.prototype.m = function (x) { calls++; return 'A13l.m' + x; };
function C13l() { this.v = 13; }
C13l.prototype = Object.create(A13l.prototype);
C13l.prototype.constructor = C13l;
C13l.prototype.own = function (x) { calls++; return 'C13l.own' + x + this.v; };
function make13l() { const o = new C13l(); escape(o); return o; }
function run13l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C13l.prototype, A13l.prototype); s += o.m(i) + ';'; } return s; }
function A13f() { }
A13f.prototype.m = function (x) { calls++; return 'A13f.m' + x; };
function C13f() { this.v = 13; }
C13f.prototype = Object.create(A13f.prototype);
C13f.prototype.constructor = C13f;
C13f.prototype.own = function (x) { calls++; return 'C13f.own' + x + this.v; };
function make13f() { const o = new C13f(); escape(o); return o; }
function call13f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run13f(o, hook) { hook(o, C13f.prototype, A13f.prototype); return call13f(o); }
function A13a() { }
A13a.prototype.m = function (x) { calls++; return 'A13a.m' + x; };
function C13a() { this.v = 13; }
C13a.prototype = Object.create(A13a.prototype);
C13a.prototype.constructor = C13a;
C13a.prototype.own = function (x) { calls++; return 'C13a.own' + x + this.v; };
function make13a() { const o = new C13a(); escape(o); return o; }
function call13a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run13a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call13a(o); hook(o, C13a.prototype, A13a.prototype); return s + '|' + call13a(o) + '|' + call13a(make13a()); }
function A14t() { }
A14t.prototype.m = function (x) { calls++; return 'A14t.m' + x; };
function C14t() { this.v = 14; }
C14t.prototype = Object.create(A14t.prototype);
C14t.prototype.constructor = C14t;
C14t.prototype.own = function (x) { calls++; return 'C14t.own' + x + this.v; };
function make14t() { const o = new C14t(); escape(o); return o; }
function run14t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C14t.prototype, A14t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A14l() { }
A14l.prototype.m = function (x) { calls++; return 'A14l.m' + x; };
function C14l() { this.v = 14; }
C14l.prototype = Object.create(A14l.prototype);
C14l.prototype.constructor = C14l;
C14l.prototype.own = function (x) { calls++; return 'C14l.own' + x + this.v; };
function make14l() { const o = new C14l(); escape(o); return o; }
function run14l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C14l.prototype, A14l.prototype); s += o.m(i) + ';'; } return s; }
function A14f() { }
A14f.prototype.m = function (x) { calls++; return 'A14f.m' + x; };
function C14f() { this.v = 14; }
C14f.prototype = Object.create(A14f.prototype);
C14f.prototype.constructor = C14f;
C14f.prototype.own = function (x) { calls++; return 'C14f.own' + x + this.v; };
function make14f() { const o = new C14f(); escape(o); return o; }
function call14f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run14f(o, hook) { hook(o, C14f.prototype, A14f.prototype); return call14f(o); }
function A14a() { }
A14a.prototype.m = function (x) { calls++; return 'A14a.m' + x; };
function C14a() { this.v = 14; }
C14a.prototype = Object.create(A14a.prototype);
C14a.prototype.constructor = C14a;
C14a.prototype.own = function (x) { calls++; return 'C14a.own' + x + this.v; };
function make14a() { const o = new C14a(); escape(o); return o; }
function call14a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run14a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call14a(o); hook(o, C14a.prototype, A14a.prototype); return s + '|' + call14a(o) + '|' + call14a(make14a()); }
function A15t() { }
A15t.prototype.m = function (x) { calls++; return 'A15t.m' + x; };
function C15t() { this.v = 15; }
C15t.prototype = Object.create(A15t.prototype);
C15t.prototype.constructor = C15t;
C15t.prototype.own = function (x) { calls++; return 'C15t.own' + x + this.v; };
function make15t() { const o = new C15t(); escape(o); return o; }
function run15t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C15t.prototype, A15t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A15l() { }
A15l.prototype.m = function (x) { calls++; return 'A15l.m' + x; };
function C15l() { this.v = 15; }
C15l.prototype = Object.create(A15l.prototype);
C15l.prototype.constructor = C15l;
C15l.prototype.own = function (x) { calls++; return 'C15l.own' + x + this.v; };
function make15l() { const o = new C15l(); escape(o); return o; }
function run15l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C15l.prototype, A15l.prototype); s += o.m(i) + ';'; } return s; }
function A15f() { }
A15f.prototype.m = function (x) { calls++; return 'A15f.m' + x; };
function C15f() { this.v = 15; }
C15f.prototype = Object.create(A15f.prototype);
C15f.prototype.constructor = C15f;
C15f.prototype.own = function (x) { calls++; return 'C15f.own' + x + this.v; };
function make15f() { const o = new C15f(); escape(o); return o; }
function call15f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run15f(o, hook) { hook(o, C15f.prototype, A15f.prototype); return call15f(o); }
function A15a() { }
A15a.prototype.m = function (x) { calls++; return 'A15a.m' + x; };
function C15a() { this.v = 15; }
C15a.prototype = Object.create(A15a.prototype);
C15a.prototype.constructor = C15a;
C15a.prototype.own = function (x) { calls++; return 'C15a.own' + x + this.v; };
function make15a() { const o = new C15a(); escape(o); return o; }
function call15a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run15a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call15a(o); hook(o, C15a.prototype, A15a.prototype); return s + '|' + call15a(o) + '|' + call15a(make15a()); }
function A16t() { }
A16t.prototype.m = function (x) { calls++; return 'A16t.m' + x; };
function C16t() { this.v = 16; }
C16t.prototype = Object.create(A16t.prototype);
C16t.prototype.constructor = C16t;
C16t.prototype.own = function (x) { calls++; return 'C16t.own' + x + this.v; };
function make16t() { const o = new C16t(); escape(o); return o; }
function run16t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C16t.prototype, A16t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A16l() { }
A16l.prototype.m = function (x) { calls++; return 'A16l.m' + x; };
function C16l() { this.v = 16; }
C16l.prototype = Object.create(A16l.prototype);
C16l.prototype.constructor = C16l;
C16l.prototype.own = function (x) { calls++; return 'C16l.own' + x + this.v; };
function make16l() { const o = new C16l(); escape(o); return o; }
function run16l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C16l.prototype, A16l.prototype); s += o.m(i) + ';'; } return s; }
function A16f() { }
A16f.prototype.m = function (x) { calls++; return 'A16f.m' + x; };
function C16f() { this.v = 16; }
C16f.prototype = Object.create(A16f.prototype);
C16f.prototype.constructor = C16f;
C16f.prototype.own = function (x) { calls++; return 'C16f.own' + x + this.v; };
function make16f() { const o = new C16f(); escape(o); return o; }
function call16f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run16f(o, hook) { hook(o, C16f.prototype, A16f.prototype); return call16f(o); }
function A16a() { }
A16a.prototype.m = function (x) { calls++; return 'A16a.m' + x; };
function C16a() { this.v = 16; }
C16a.prototype = Object.create(A16a.prototype);
C16a.prototype.constructor = C16a;
C16a.prototype.own = function (x) { calls++; return 'C16a.own' + x + this.v; };
function make16a() { const o = new C16a(); escape(o); return o; }
function call16a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run16a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call16a(o); hook(o, C16a.prototype, A16a.prototype); return s + '|' + call16a(o) + '|' + call16a(make16a()); }
function A17t() { }
A17t.prototype.m = function (x) { calls++; return 'A17t.m' + x; };
function C17t() { this.v = 17; }
C17t.prototype = Object.create(A17t.prototype);
C17t.prototype.constructor = C17t;
C17t.prototype.own = function (x) { calls++; return 'C17t.own' + x + this.v; };
function make17t() { const o = new C17t(); escape(o); return o; }
function run17t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C17t.prototype, A17t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A17l() { }
A17l.prototype.m = function (x) { calls++; return 'A17l.m' + x; };
function C17l() { this.v = 17; }
C17l.prototype = Object.create(A17l.prototype);
C17l.prototype.constructor = C17l;
C17l.prototype.own = function (x) { calls++; return 'C17l.own' + x + this.v; };
function make17l() { const o = new C17l(); escape(o); return o; }
function run17l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C17l.prototype, A17l.prototype); s += o.m(i) + ';'; } return s; }
function A17f() { }
A17f.prototype.m = function (x) { calls++; return 'A17f.m' + x; };
function C17f() { this.v = 17; }
C17f.prototype = Object.create(A17f.prototype);
C17f.prototype.constructor = C17f;
C17f.prototype.own = function (x) { calls++; return 'C17f.own' + x + this.v; };
function make17f() { const o = new C17f(); escape(o); return o; }
function call17f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run17f(o, hook) { hook(o, C17f.prototype, A17f.prototype); return call17f(o); }
function A17a() { }
A17a.prototype.m = function (x) { calls++; return 'A17a.m' + x; };
function C17a() { this.v = 17; }
C17a.prototype = Object.create(A17a.prototype);
C17a.prototype.constructor = C17a;
C17a.prototype.own = function (x) { calls++; return 'C17a.own' + x + this.v; };
function make17a() { const o = new C17a(); escape(o); return o; }
function call17a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run17a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call17a(o); hook(o, C17a.prototype, A17a.prototype); return s + '|' + call17a(o) + '|' + call17a(make17a()); }
function A18t() { }
A18t.prototype.m = function (x) { calls++; return 'A18t.m' + x; };
function C18t() { this.v = 18; }
C18t.prototype = Object.create(A18t.prototype);
C18t.prototype.constructor = C18t;
C18t.prototype.own = function (x) { calls++; return 'C18t.own' + x + this.v; };
function make18t() { const o = new C18t(); escape(o); return o; }
function run18t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C18t.prototype, A18t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A18l() { }
A18l.prototype.m = function (x) { calls++; return 'A18l.m' + x; };
function C18l() { this.v = 18; }
C18l.prototype = Object.create(A18l.prototype);
C18l.prototype.constructor = C18l;
C18l.prototype.own = function (x) { calls++; return 'C18l.own' + x + this.v; };
function make18l() { const o = new C18l(); escape(o); return o; }
function run18l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C18l.prototype, A18l.prototype); s += o.m(i) + ';'; } return s; }
function A18f() { }
A18f.prototype.m = function (x) { calls++; return 'A18f.m' + x; };
function C18f() { this.v = 18; }
C18f.prototype = Object.create(A18f.prototype);
C18f.prototype.constructor = C18f;
C18f.prototype.own = function (x) { calls++; return 'C18f.own' + x + this.v; };
function make18f() { const o = new C18f(); escape(o); return o; }
function call18f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run18f(o, hook) { hook(o, C18f.prototype, A18f.prototype); return call18f(o); }
function A18a() { }
A18a.prototype.m = function (x) { calls++; return 'A18a.m' + x; };
function C18a() { this.v = 18; }
C18a.prototype = Object.create(A18a.prototype);
C18a.prototype.constructor = C18a;
C18a.prototype.own = function (x) { calls++; return 'C18a.own' + x + this.v; };
function make18a() { const o = new C18a(); escape(o); return o; }
function call18a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run18a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call18a(o); hook(o, C18a.prototype, A18a.prototype); return s + '|' + call18a(o) + '|' + call18a(make18a()); }
function A19t() { }
A19t.prototype.m = function (x) { calls++; return 'A19t.m' + x; };
function C19t() { this.v = 19; }
C19t.prototype = Object.create(A19t.prototype);
C19t.prototype.constructor = C19t;
C19t.prototype.own = function (x) { calls++; return 'C19t.own' + x + this.v; };
function make19t() { const o = new C19t(); escape(o); return o; }
function run19t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C19t.prototype, A19t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A19l() { }
A19l.prototype.m = function (x) { calls++; return 'A19l.m' + x; };
function C19l() { this.v = 19; }
C19l.prototype = Object.create(A19l.prototype);
C19l.prototype.constructor = C19l;
C19l.prototype.own = function (x) { calls++; return 'C19l.own' + x + this.v; };
function make19l() { const o = new C19l(); escape(o); return o; }
function run19l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C19l.prototype, A19l.prototype); s += o.m(i) + ';'; } return s; }
function A19f() { }
A19f.prototype.m = function (x) { calls++; return 'A19f.m' + x; };
function C19f() { this.v = 19; }
C19f.prototype = Object.create(A19f.prototype);
C19f.prototype.constructor = C19f;
C19f.prototype.own = function (x) { calls++; return 'C19f.own' + x + this.v; };
function make19f() { const o = new C19f(); escape(o); return o; }
function call19f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run19f(o, hook) { hook(o, C19f.prototype, A19f.prototype); return call19f(o); }
function A19a() { }
A19a.prototype.m = function (x) { calls++; return 'A19a.m' + x; };
function C19a() { this.v = 19; }
C19a.prototype = Object.create(A19a.prototype);
C19a.prototype.constructor = C19a;
C19a.prototype.own = function (x) { calls++; return 'C19a.own' + x + this.v; };
function make19a() { const o = new C19a(); escape(o); return o; }
function call19a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run19a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call19a(o); hook(o, C19a.prototype, A19a.prototype); return s + '|' + call19a(o) + '|' + call19a(make19a()); }
function A20t() { }
A20t.prototype.m = function (x) { calls++; return 'A20t.m' + x; };
function C20t() { this.v = 20; }
C20t.prototype = Object.create(A20t.prototype);
C20t.prototype.constructor = C20t;
C20t.prototype.own = function (x) { calls++; return 'C20t.own' + x + this.v; };
function make20t() { const o = new C20t(); escape(o); return o; }
function run20t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C20t.prototype, A20t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A20l() { }
A20l.prototype.m = function (x) { calls++; return 'A20l.m' + x; };
function C20l() { this.v = 20; }
C20l.prototype = Object.create(A20l.prototype);
C20l.prototype.constructor = C20l;
C20l.prototype.own = function (x) { calls++; return 'C20l.own' + x + this.v; };
function make20l() { const o = new C20l(); escape(o); return o; }
function run20l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C20l.prototype, A20l.prototype); s += o.m(i) + ';'; } return s; }
function A20f() { }
A20f.prototype.m = function (x) { calls++; return 'A20f.m' + x; };
function C20f() { this.v = 20; }
C20f.prototype = Object.create(A20f.prototype);
C20f.prototype.constructor = C20f;
C20f.prototype.own = function (x) { calls++; return 'C20f.own' + x + this.v; };
function make20f() { const o = new C20f(); escape(o); return o; }
function call20f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run20f(o, hook) { hook(o, C20f.prototype, A20f.prototype); return call20f(o); }
function A20a() { }
A20a.prototype.m = function (x) { calls++; return 'A20a.m' + x; };
function C20a() { this.v = 20; }
C20a.prototype = Object.create(A20a.prototype);
C20a.prototype.constructor = C20a;
C20a.prototype.own = function (x) { calls++; return 'C20a.own' + x + this.v; };
function make20a() { const o = new C20a(); escape(o); return o; }
function call20a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run20a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call20a(o); hook(o, C20a.prototype, A20a.prototype); return s + '|' + call20a(o) + '|' + call20a(make20a()); }
function A21t() { }
A21t.prototype.m = function (x) { calls++; return 'A21t.m' + x; };
function C21t() { this.v = 21; }
C21t.prototype = Object.create(A21t.prototype);
C21t.prototype.constructor = C21t;
C21t.prototype.own = function (x) { calls++; return 'C21t.own' + x + this.v; };
function make21t() { const o = new C21t(); escape(o); return o; }
function run21t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C21t.prototype, A21t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A21l() { }
A21l.prototype.m = function (x) { calls++; return 'A21l.m' + x; };
function C21l() { this.v = 21; }
C21l.prototype = Object.create(A21l.prototype);
C21l.prototype.constructor = C21l;
C21l.prototype.own = function (x) { calls++; return 'C21l.own' + x + this.v; };
function make21l() { const o = new C21l(); escape(o); return o; }
function run21l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C21l.prototype, A21l.prototype); s += o.m(i) + ';'; } return s; }
function A21f() { }
A21f.prototype.m = function (x) { calls++; return 'A21f.m' + x; };
function C21f() { this.v = 21; }
C21f.prototype = Object.create(A21f.prototype);
C21f.prototype.constructor = C21f;
C21f.prototype.own = function (x) { calls++; return 'C21f.own' + x + this.v; };
function make21f() { const o = new C21f(); escape(o); return o; }
function call21f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run21f(o, hook) { hook(o, C21f.prototype, A21f.prototype); return call21f(o); }
function A21a() { }
A21a.prototype.m = function (x) { calls++; return 'A21a.m' + x; };
function C21a() { this.v = 21; }
C21a.prototype = Object.create(A21a.prototype);
C21a.prototype.constructor = C21a;
C21a.prototype.own = function (x) { calls++; return 'C21a.own' + x + this.v; };
function make21a() { const o = new C21a(); escape(o); return o; }
function call21a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run21a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call21a(o); hook(o, C21a.prototype, A21a.prototype); return s + '|' + call21a(o) + '|' + call21a(make21a()); }
function A22t() { }
A22t.prototype.m = function (x) { calls++; return 'A22t.m' + x; };
function C22t() { this.v = 22; }
C22t.prototype = Object.create(A22t.prototype);
C22t.prototype.constructor = C22t;
C22t.prototype.own = function (x) { calls++; return 'C22t.own' + x + this.v; };
function make22t() { const o = new C22t(); escape(o); return o; }
function run22t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C22t.prototype, A22t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A22l() { }
A22l.prototype.m = function (x) { calls++; return 'A22l.m' + x; };
function C22l() { this.v = 22; }
C22l.prototype = Object.create(A22l.prototype);
C22l.prototype.constructor = C22l;
C22l.prototype.own = function (x) { calls++; return 'C22l.own' + x + this.v; };
function make22l() { const o = new C22l(); escape(o); return o; }
function run22l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C22l.prototype, A22l.prototype); s += o.m(i) + ';'; } return s; }
function A22f() { }
A22f.prototype.m = function (x) { calls++; return 'A22f.m' + x; };
function C22f() { this.v = 22; }
C22f.prototype = Object.create(A22f.prototype);
C22f.prototype.constructor = C22f;
C22f.prototype.own = function (x) { calls++; return 'C22f.own' + x + this.v; };
function make22f() { const o = new C22f(); escape(o); return o; }
function call22f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run22f(o, hook) { hook(o, C22f.prototype, A22f.prototype); return call22f(o); }
function A22a() { }
A22a.prototype.m = function (x) { calls++; return 'A22a.m' + x; };
function C22a() { this.v = 22; }
C22a.prototype = Object.create(A22a.prototype);
C22a.prototype.constructor = C22a;
C22a.prototype.own = function (x) { calls++; return 'C22a.own' + x + this.v; };
function make22a() { const o = new C22a(); escape(o); return o; }
function call22a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run22a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call22a(o); hook(o, C22a.prototype, A22a.prototype); return s + '|' + call22a(o) + '|' + call22a(make22a()); }
function A23t() { }
A23t.prototype.m = function (x) { calls++; return 'A23t.m' + x; };
function C23t() { this.v = 23; }
C23t.prototype = Object.create(A23t.prototype);
C23t.prototype.constructor = C23t;
C23t.prototype.own = function (x) { calls++; return 'C23t.own' + x + this.v; };
function make23t() { const o = new C23t(); escape(o); return o; }
function run23t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C23t.prototype, A23t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A23l() { }
A23l.prototype.m = function (x) { calls++; return 'A23l.m' + x; };
function C23l() { this.v = 23; }
C23l.prototype = Object.create(A23l.prototype);
C23l.prototype.constructor = C23l;
C23l.prototype.own = function (x) { calls++; return 'C23l.own' + x + this.v; };
function make23l() { const o = new C23l(); escape(o); return o; }
function run23l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C23l.prototype, A23l.prototype); s += o.m(i) + ';'; } return s; }
function A23f() { }
A23f.prototype.m = function (x) { calls++; return 'A23f.m' + x; };
function C23f() { this.v = 23; }
C23f.prototype = Object.create(A23f.prototype);
C23f.prototype.constructor = C23f;
C23f.prototype.own = function (x) { calls++; return 'C23f.own' + x + this.v; };
function make23f() { const o = new C23f(); escape(o); return o; }
function call23f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run23f(o, hook) { hook(o, C23f.prototype, A23f.prototype); return call23f(o); }
function A23a() { }
A23a.prototype.m = function (x) { calls++; return 'A23a.m' + x; };
function C23a() { this.v = 23; }
C23a.prototype = Object.create(A23a.prototype);
C23a.prototype.constructor = C23a;
C23a.prototype.own = function (x) { calls++; return 'C23a.own' + x + this.v; };
function make23a() { const o = new C23a(); escape(o); return o; }
function call23a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run23a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call23a(o); hook(o, C23a.prototype, A23a.prototype); return s + '|' + call23a(o) + '|' + call23a(make23a()); }
function A24t() { }
A24t.prototype.m = function (x) { calls++; return 'A24t.m' + x; };
function C24t() { this.v = 24; }
C24t.prototype = Object.create(A24t.prototype);
C24t.prototype.constructor = C24t;
C24t.prototype.own = function (x) { calls++; return 'C24t.own' + x + this.v; };
function make24t() { const o = new C24t(); escape(o); return o; }
function run24t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C24t.prototype, A24t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A24l() { }
A24l.prototype.m = function (x) { calls++; return 'A24l.m' + x; };
function C24l() { this.v = 24; }
C24l.prototype = Object.create(A24l.prototype);
C24l.prototype.constructor = C24l;
C24l.prototype.own = function (x) { calls++; return 'C24l.own' + x + this.v; };
function make24l() { const o = new C24l(); escape(o); return o; }
function run24l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C24l.prototype, A24l.prototype); s += o.m(i) + ';'; } return s; }
function A24f() { }
A24f.prototype.m = function (x) { calls++; return 'A24f.m' + x; };
function C24f() { this.v = 24; }
C24f.prototype = Object.create(A24f.prototype);
C24f.prototype.constructor = C24f;
C24f.prototype.own = function (x) { calls++; return 'C24f.own' + x + this.v; };
function make24f() { const o = new C24f(); escape(o); return o; }
function call24f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run24f(o, hook) { hook(o, C24f.prototype, A24f.prototype); return call24f(o); }
function A24a() { }
A24a.prototype.m = function (x) { calls++; return 'A24a.m' + x; };
function C24a() { this.v = 24; }
C24a.prototype = Object.create(A24a.prototype);
C24a.prototype.constructor = C24a;
C24a.prototype.own = function (x) { calls++; return 'C24a.own' + x + this.v; };
function make24a() { const o = new C24a(); escape(o); return o; }
function call24a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run24a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call24a(o); hook(o, C24a.prototype, A24a.prototype); return s + '|' + call24a(o) + '|' + call24a(make24a()); }
function A25t() { }
A25t.prototype.m = function (x) { calls++; return 'A25t.m' + x; };
function C25t() { this.v = 25; }
C25t.prototype = Object.create(A25t.prototype);
C25t.prototype.constructor = C25t;
C25t.prototype.own = function (x) { calls++; return 'C25t.own' + x + this.v; };
function make25t() { const o = new C25t(); escape(o); return o; }
function run25t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C25t.prototype, A25t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A25l() { }
A25l.prototype.m = function (x) { calls++; return 'A25l.m' + x; };
function C25l() { this.v = 25; }
C25l.prototype = Object.create(A25l.prototype);
C25l.prototype.constructor = C25l;
C25l.prototype.own = function (x) { calls++; return 'C25l.own' + x + this.v; };
function make25l() { const o = new C25l(); escape(o); return o; }
function run25l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C25l.prototype, A25l.prototype); s += o.m(i) + ';'; } return s; }
function A25f() { }
A25f.prototype.m = function (x) { calls++; return 'A25f.m' + x; };
function C25f() { this.v = 25; }
C25f.prototype = Object.create(A25f.prototype);
C25f.prototype.constructor = C25f;
C25f.prototype.own = function (x) { calls++; return 'C25f.own' + x + this.v; };
function make25f() { const o = new C25f(); escape(o); return o; }
function call25f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run25f(o, hook) { hook(o, C25f.prototype, A25f.prototype); return call25f(o); }
function A25a() { }
A25a.prototype.m = function (x) { calls++; return 'A25a.m' + x; };
function C25a() { this.v = 25; }
C25a.prototype = Object.create(A25a.prototype);
C25a.prototype.constructor = C25a;
C25a.prototype.own = function (x) { calls++; return 'C25a.own' + x + this.v; };
function make25a() { const o = new C25a(); escape(o); return o; }
function call25a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run25a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call25a(o); hook(o, C25a.prototype, A25a.prototype); return s + '|' + call25a(o) + '|' + call25a(make25a()); }
function A26t() { }
A26t.prototype.m = function (x) { calls++; return 'A26t.m' + x; };
function C26t() { this.v = 26; }
C26t.prototype = Object.create(A26t.prototype);
C26t.prototype.constructor = C26t;
C26t.prototype.own = function (x) { calls++; return 'C26t.own' + x + this.v; };
function make26t() { const o = new C26t(); escape(o); return o; }
function run26t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C26t.prototype, A26t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A26l() { }
A26l.prototype.m = function (x) { calls++; return 'A26l.m' + x; };
function C26l() { this.v = 26; }
C26l.prototype = Object.create(A26l.prototype);
C26l.prototype.constructor = C26l;
C26l.prototype.own = function (x) { calls++; return 'C26l.own' + x + this.v; };
function make26l() { const o = new C26l(); escape(o); return o; }
function run26l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C26l.prototype, A26l.prototype); s += o.m(i) + ';'; } return s; }
function A26f() { }
A26f.prototype.m = function (x) { calls++; return 'A26f.m' + x; };
function C26f() { this.v = 26; }
C26f.prototype = Object.create(A26f.prototype);
C26f.prototype.constructor = C26f;
C26f.prototype.own = function (x) { calls++; return 'C26f.own' + x + this.v; };
function make26f() { const o = new C26f(); escape(o); return o; }
function call26f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run26f(o, hook) { hook(o, C26f.prototype, A26f.prototype); return call26f(o); }
function A26a() { }
A26a.prototype.m = function (x) { calls++; return 'A26a.m' + x; };
function C26a() { this.v = 26; }
C26a.prototype = Object.create(A26a.prototype);
C26a.prototype.constructor = C26a;
C26a.prototype.own = function (x) { calls++; return 'C26a.own' + x + this.v; };
function make26a() { const o = new C26a(); escape(o); return o; }
function call26a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run26a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call26a(o); hook(o, C26a.prototype, A26a.prototype); return s + '|' + call26a(o) + '|' + call26a(make26a()); }
function A27t() { }
A27t.prototype.m = function (x) { calls++; return 'A27t.m' + x; };
function C27t() { this.v = 27; }
C27t.prototype = Object.create(A27t.prototype);
C27t.prototype.constructor = C27t;
C27t.prototype.own = function (x) { calls++; return 'C27t.own' + x + this.v; };
function make27t() { const o = new C27t(); escape(o); return o; }
function run27t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C27t.prototype, A27t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A27l() { }
A27l.prototype.m = function (x) { calls++; return 'A27l.m' + x; };
function C27l() { this.v = 27; }
C27l.prototype = Object.create(A27l.prototype);
C27l.prototype.constructor = C27l;
C27l.prototype.own = function (x) { calls++; return 'C27l.own' + x + this.v; };
function make27l() { const o = new C27l(); escape(o); return o; }
function run27l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C27l.prototype, A27l.prototype); s += o.m(i) + ';'; } return s; }
function A27f() { }
A27f.prototype.m = function (x) { calls++; return 'A27f.m' + x; };
function C27f() { this.v = 27; }
C27f.prototype = Object.create(A27f.prototype);
C27f.prototype.constructor = C27f;
C27f.prototype.own = function (x) { calls++; return 'C27f.own' + x + this.v; };
function make27f() { const o = new C27f(); escape(o); return o; }
function call27f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run27f(o, hook) { hook(o, C27f.prototype, A27f.prototype); return call27f(o); }
function A27a() { }
A27a.prototype.m = function (x) { calls++; return 'A27a.m' + x; };
function C27a() { this.v = 27; }
C27a.prototype = Object.create(A27a.prototype);
C27a.prototype.constructor = C27a;
C27a.prototype.own = function (x) { calls++; return 'C27a.own' + x + this.v; };
function make27a() { const o = new C27a(); escape(o); return o; }
function call27a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run27a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call27a(o); hook(o, C27a.prototype, A27a.prototype); return s + '|' + call27a(o) + '|' + call27a(make27a()); }
function A28t() { }
A28t.prototype.m = function (x) { calls++; return 'A28t.m' + x; };
function C28t() { this.v = 28; }
C28t.prototype = Object.create(A28t.prototype);
C28t.prototype.constructor = C28t;
C28t.prototype.own = function (x) { calls++; return 'C28t.own' + x + this.v; };
function make28t() { const o = new C28t(); escape(o); return o; }
function run28t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C28t.prototype, A28t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A28l() { }
A28l.prototype.m = function (x) { calls++; return 'A28l.m' + x; };
function C28l() { this.v = 28; }
C28l.prototype = Object.create(A28l.prototype);
C28l.prototype.constructor = C28l;
C28l.prototype.own = function (x) { calls++; return 'C28l.own' + x + this.v; };
function make28l() { const o = new C28l(); escape(o); return o; }
function run28l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C28l.prototype, A28l.prototype); s += o.m(i) + ';'; } return s; }
function A28f() { }
A28f.prototype.m = function (x) { calls++; return 'A28f.m' + x; };
function C28f() { this.v = 28; }
C28f.prototype = Object.create(A28f.prototype);
C28f.prototype.constructor = C28f;
C28f.prototype.own = function (x) { calls++; return 'C28f.own' + x + this.v; };
function make28f() { const o = new C28f(); escape(o); return o; }
function call28f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run28f(o, hook) { hook(o, C28f.prototype, A28f.prototype); return call28f(o); }
function A28a() { }
A28a.prototype.m = function (x) { calls++; return 'A28a.m' + x; };
function C28a() { this.v = 28; }
C28a.prototype = Object.create(A28a.prototype);
C28a.prototype.constructor = C28a;
C28a.prototype.own = function (x) { calls++; return 'C28a.own' + x + this.v; };
function make28a() { const o = new C28a(); escape(o); return o; }
function call28a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run28a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call28a(o); hook(o, C28a.prototype, A28a.prototype); return s + '|' + call28a(o) + '|' + call28a(make28a()); }
function A29t() { }
A29t.prototype.m = function (x) { calls++; return 'A29t.m' + x; };
function C29t() { this.v = 29; }
C29t.prototype = Object.create(A29t.prototype);
C29t.prototype.constructor = C29t;
C29t.prototype.own = function (x) { calls++; return 'C29t.own' + x + this.v; };
function make29t() { const o = new C29t(); escape(o); return o; }
function run29t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C29t.prototype, A29t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A29l() { }
A29l.prototype.m = function (x) { calls++; return 'A29l.m' + x; };
function C29l() { this.v = 29; }
C29l.prototype = Object.create(A29l.prototype);
C29l.prototype.constructor = C29l;
C29l.prototype.own = function (x) { calls++; return 'C29l.own' + x + this.v; };
function make29l() { const o = new C29l(); escape(o); return o; }
function run29l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C29l.prototype, A29l.prototype); s += o.m(i) + ';'; } return s; }
function A29f() { }
A29f.prototype.m = function (x) { calls++; return 'A29f.m' + x; };
function C29f() { this.v = 29; }
C29f.prototype = Object.create(A29f.prototype);
C29f.prototype.constructor = C29f;
C29f.prototype.own = function (x) { calls++; return 'C29f.own' + x + this.v; };
function make29f() { const o = new C29f(); escape(o); return o; }
function call29f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run29f(o, hook) { hook(o, C29f.prototype, A29f.prototype); return call29f(o); }
function A29a() { }
A29a.prototype.m = function (x) { calls++; return 'A29a.m' + x; };
function C29a() { this.v = 29; }
C29a.prototype = Object.create(A29a.prototype);
C29a.prototype.constructor = C29a;
C29a.prototype.own = function (x) { calls++; return 'C29a.own' + x + this.v; };
function make29a() { const o = new C29a(); escape(o); return o; }
function call29a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run29a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call29a(o); hook(o, C29a.prototype, A29a.prototype); return s + '|' + call29a(o) + '|' + call29a(make29a()); }
function A30t() { }
A30t.prototype.m = function (x) { calls++; return 'A30t.m' + x; };
function C30t() { this.v = 30; }
C30t.prototype = Object.create(A30t.prototype);
C30t.prototype.constructor = C30t;
C30t.prototype.own = function (x) { calls++; return 'C30t.own' + x + this.v; };
function make30t() { const o = new C30t(); escape(o); return o; }
function run30t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C30t.prototype, A30t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A30l() { }
A30l.prototype.m = function (x) { calls++; return 'A30l.m' + x; };
function C30l() { this.v = 30; }
C30l.prototype = Object.create(A30l.prototype);
C30l.prototype.constructor = C30l;
C30l.prototype.own = function (x) { calls++; return 'C30l.own' + x + this.v; };
function make30l() { const o = new C30l(); escape(o); return o; }
function run30l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C30l.prototype, A30l.prototype); s += o.m(i) + ';'; } return s; }
function A30f() { }
A30f.prototype.m = function (x) { calls++; return 'A30f.m' + x; };
function C30f() { this.v = 30; }
C30f.prototype = Object.create(A30f.prototype);
C30f.prototype.constructor = C30f;
C30f.prototype.own = function (x) { calls++; return 'C30f.own' + x + this.v; };
function make30f() { const o = new C30f(); escape(o); return o; }
function call30f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run30f(o, hook) { hook(o, C30f.prototype, A30f.prototype); return call30f(o); }
function A30a() { }
A30a.prototype.m = function (x) { calls++; return 'A30a.m' + x; };
function C30a() { this.v = 30; }
C30a.prototype = Object.create(A30a.prototype);
C30a.prototype.constructor = C30a;
C30a.prototype.own = function (x) { calls++; return 'C30a.own' + x + this.v; };
function make30a() { const o = new C30a(); escape(o); return o; }
function call30a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run30a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call30a(o); hook(o, C30a.prototype, A30a.prototype); return s + '|' + call30a(o) + '|' + call30a(make30a()); }
function A31t() { }
A31t.prototype.m = function (x) { calls++; return 'A31t.m' + x; };
function C31t() { this.v = 31; }
C31t.prototype = Object.create(A31t.prototype);
C31t.prototype.constructor = C31t;
C31t.prototype.own = function (x) { calls++; return 'C31t.own' + x + this.v; };
function make31t() { const o = new C31t(); escape(o); return o; }
function run31t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C31t.prototype, A31t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A31l() { }
A31l.prototype.m = function (x) { calls++; return 'A31l.m' + x; };
function C31l() { this.v = 31; }
C31l.prototype = Object.create(A31l.prototype);
C31l.prototype.constructor = C31l;
C31l.prototype.own = function (x) { calls++; return 'C31l.own' + x + this.v; };
function make31l() { const o = new C31l(); escape(o); return o; }
function run31l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C31l.prototype, A31l.prototype); s += o.m(i) + ';'; } return s; }
function A31f() { }
A31f.prototype.m = function (x) { calls++; return 'A31f.m' + x; };
function C31f() { this.v = 31; }
C31f.prototype = Object.create(A31f.prototype);
C31f.prototype.constructor = C31f;
C31f.prototype.own = function (x) { calls++; return 'C31f.own' + x + this.v; };
function make31f() { const o = new C31f(); escape(o); return o; }
function call31f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run31f(o, hook) { hook(o, C31f.prototype, A31f.prototype); return call31f(o); }
function A31a() { }
A31a.prototype.m = function (x) { calls++; return 'A31a.m' + x; };
function C31a() { this.v = 31; }
C31a.prototype = Object.create(A31a.prototype);
C31a.prototype.constructor = C31a;
C31a.prototype.own = function (x) { calls++; return 'C31a.own' + x + this.v; };
function make31a() { const o = new C31a(); escape(o); return o; }
function call31a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run31a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call31a(o); hook(o, C31a.prototype, A31a.prototype); return s + '|' + call31a(o) + '|' + call31a(make31a()); }
function A32t() { }
A32t.prototype.m = function (x) { calls++; return 'A32t.m' + x; };
function C32t() { this.v = 32; }
C32t.prototype = Object.create(A32t.prototype);
C32t.prototype.constructor = C32t;
C32t.prototype.own = function (x) { calls++; return 'C32t.own' + x + this.v; };
function make32t() { const o = new C32t(); escape(o); return o; }
function run32t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C32t.prototype, A32t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A32l() { }
A32l.prototype.m = function (x) { calls++; return 'A32l.m' + x; };
function C32l() { this.v = 32; }
C32l.prototype = Object.create(A32l.prototype);
C32l.prototype.constructor = C32l;
C32l.prototype.own = function (x) { calls++; return 'C32l.own' + x + this.v; };
function make32l() { const o = new C32l(); escape(o); return o; }
function run32l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C32l.prototype, A32l.prototype); s += o.m(i) + ';'; } return s; }
function A32f() { }
A32f.prototype.m = function (x) { calls++; return 'A32f.m' + x; };
function C32f() { this.v = 32; }
C32f.prototype = Object.create(A32f.prototype);
C32f.prototype.constructor = C32f;
C32f.prototype.own = function (x) { calls++; return 'C32f.own' + x + this.v; };
function make32f() { const o = new C32f(); escape(o); return o; }
function call32f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run32f(o, hook) { hook(o, C32f.prototype, A32f.prototype); return call32f(o); }
function A32a() { }
A32a.prototype.m = function (x) { calls++; return 'A32a.m' + x; };
function C32a() { this.v = 32; }
C32a.prototype = Object.create(A32a.prototype);
C32a.prototype.constructor = C32a;
C32a.prototype.own = function (x) { calls++; return 'C32a.own' + x + this.v; };
function make32a() { const o = new C32a(); escape(o); return o; }
function call32a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run32a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call32a(o); hook(o, C32a.prototype, A32a.prototype); return s + '|' + call32a(o) + '|' + call32a(make32a()); }
function A33t() { }
A33t.prototype.m = function (x) { calls++; return 'A33t.m' + x; };
function C33t() { this.v = 33; }
C33t.prototype = Object.create(A33t.prototype);
C33t.prototype.constructor = C33t;
C33t.prototype.own = function (x) { calls++; return 'C33t.own' + x + this.v; };
function make33t() { const o = new C33t(); escape(o); return o; }
function run33t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C33t.prototype, A33t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A33l() { }
A33l.prototype.m = function (x) { calls++; return 'A33l.m' + x; };
function C33l() { this.v = 33; }
C33l.prototype = Object.create(A33l.prototype);
C33l.prototype.constructor = C33l;
C33l.prototype.own = function (x) { calls++; return 'C33l.own' + x + this.v; };
function make33l() { const o = new C33l(); escape(o); return o; }
function run33l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C33l.prototype, A33l.prototype); s += o.m(i) + ';'; } return s; }
function A33f() { }
A33f.prototype.m = function (x) { calls++; return 'A33f.m' + x; };
function C33f() { this.v = 33; }
C33f.prototype = Object.create(A33f.prototype);
C33f.prototype.constructor = C33f;
C33f.prototype.own = function (x) { calls++; return 'C33f.own' + x + this.v; };
function make33f() { const o = new C33f(); escape(o); return o; }
function call33f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run33f(o, hook) { hook(o, C33f.prototype, A33f.prototype); return call33f(o); }
function A33a() { }
A33a.prototype.m = function (x) { calls++; return 'A33a.m' + x; };
function C33a() { this.v = 33; }
C33a.prototype = Object.create(A33a.prototype);
C33a.prototype.constructor = C33a;
C33a.prototype.own = function (x) { calls++; return 'C33a.own' + x + this.v; };
function make33a() { const o = new C33a(); escape(o); return o; }
function call33a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run33a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call33a(o); hook(o, C33a.prototype, A33a.prototype); return s + '|' + call33a(o) + '|' + call33a(make33a()); }
function A34t() { }
A34t.prototype.m = function (x) { calls++; return 'A34t.m' + x; };
function C34t() { this.v = 34; }
C34t.prototype = Object.create(A34t.prototype);
C34t.prototype.constructor = C34t;
C34t.prototype.own = function (x) { calls++; return 'C34t.own' + x + this.v; };
function make34t() { const o = new C34t(); escape(o); return o; }
function run34t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C34t.prototype, A34t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A34l() { }
A34l.prototype.m = function (x) { calls++; return 'A34l.m' + x; };
function C34l() { this.v = 34; }
C34l.prototype = Object.create(A34l.prototype);
C34l.prototype.constructor = C34l;
C34l.prototype.own = function (x) { calls++; return 'C34l.own' + x + this.v; };
function make34l() { const o = new C34l(); escape(o); return o; }
function run34l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C34l.prototype, A34l.prototype); s += o.m(i) + ';'; } return s; }
function A34f() { }
A34f.prototype.m = function (x) { calls++; return 'A34f.m' + x; };
function C34f() { this.v = 34; }
C34f.prototype = Object.create(A34f.prototype);
C34f.prototype.constructor = C34f;
C34f.prototype.own = function (x) { calls++; return 'C34f.own' + x + this.v; };
function make34f() { const o = new C34f(); escape(o); return o; }
function call34f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run34f(o, hook) { hook(o, C34f.prototype, A34f.prototype); return call34f(o); }
function A34a() { }
A34a.prototype.m = function (x) { calls++; return 'A34a.m' + x; };
function C34a() { this.v = 34; }
C34a.prototype = Object.create(A34a.prototype);
C34a.prototype.constructor = C34a;
C34a.prototype.own = function (x) { calls++; return 'C34a.own' + x + this.v; };
function make34a() { const o = new C34a(); escape(o); return o; }
function call34a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run34a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call34a(o); hook(o, C34a.prototype, A34a.prototype); return s + '|' + call34a(o) + '|' + call34a(make34a()); }
function A35t() { }
A35t.prototype.m = function (x) { calls++; return 'A35t.m' + x; };
function C35t() { this.v = 35; }
C35t.prototype = Object.create(A35t.prototype);
C35t.prototype.constructor = C35t;
C35t.prototype.own = function (x) { calls++; return 'C35t.own' + x + this.v; };
function make35t() { const o = new C35t(); escape(o); return o; }
function run35t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C35t.prototype, A35t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A35l() { }
A35l.prototype.m = function (x) { calls++; return 'A35l.m' + x; };
function C35l() { this.v = 35; }
C35l.prototype = Object.create(A35l.prototype);
C35l.prototype.constructor = C35l;
C35l.prototype.own = function (x) { calls++; return 'C35l.own' + x + this.v; };
function make35l() { const o = new C35l(); escape(o); return o; }
function run35l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C35l.prototype, A35l.prototype); s += o.m(i) + ';'; } return s; }
function A35f() { }
A35f.prototype.m = function (x) { calls++; return 'A35f.m' + x; };
function C35f() { this.v = 35; }
C35f.prototype = Object.create(A35f.prototype);
C35f.prototype.constructor = C35f;
C35f.prototype.own = function (x) { calls++; return 'C35f.own' + x + this.v; };
function make35f() { const o = new C35f(); escape(o); return o; }
function call35f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run35f(o, hook) { hook(o, C35f.prototype, A35f.prototype); return call35f(o); }
function A35a() { }
A35a.prototype.m = function (x) { calls++; return 'A35a.m' + x; };
function C35a() { this.v = 35; }
C35a.prototype = Object.create(A35a.prototype);
C35a.prototype.constructor = C35a;
C35a.prototype.own = function (x) { calls++; return 'C35a.own' + x + this.v; };
function make35a() { const o = new C35a(); escape(o); return o; }
function call35a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run35a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call35a(o); hook(o, C35a.prototype, A35a.prototype); return s + '|' + call35a(o) + '|' + call35a(make35a()); }
function A36t() { }
A36t.prototype.m = function (x) { calls++; return 'A36t.m' + x; };
function C36t() { this.v = 36; }
C36t.prototype = Object.create(A36t.prototype);
C36t.prototype.constructor = C36t;
C36t.prototype.own = function (x) { calls++; return 'C36t.own' + x + this.v; };
function make36t() { const o = new C36t(); escape(o); return o; }
function run36t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C36t.prototype, A36t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A36l() { }
A36l.prototype.m = function (x) { calls++; return 'A36l.m' + x; };
function C36l() { this.v = 36; }
C36l.prototype = Object.create(A36l.prototype);
C36l.prototype.constructor = C36l;
C36l.prototype.own = function (x) { calls++; return 'C36l.own' + x + this.v; };
function make36l() { const o = new C36l(); escape(o); return o; }
function run36l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C36l.prototype, A36l.prototype); s += o.m(i) + ';'; } return s; }
function A36f() { }
A36f.prototype.m = function (x) { calls++; return 'A36f.m' + x; };
function C36f() { this.v = 36; }
C36f.prototype = Object.create(A36f.prototype);
C36f.prototype.constructor = C36f;
C36f.prototype.own = function (x) { calls++; return 'C36f.own' + x + this.v; };
function make36f() { const o = new C36f(); escape(o); return o; }
function call36f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run36f(o, hook) { hook(o, C36f.prototype, A36f.prototype); return call36f(o); }
function A36a() { }
A36a.prototype.m = function (x) { calls++; return 'A36a.m' + x; };
function C36a() { this.v = 36; }
C36a.prototype = Object.create(A36a.prototype);
C36a.prototype.constructor = C36a;
C36a.prototype.own = function (x) { calls++; return 'C36a.own' + x + this.v; };
function make36a() { const o = new C36a(); escape(o); return o; }
function call36a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run36a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call36a(o); hook(o, C36a.prototype, A36a.prototype); return s + '|' + call36a(o) + '|' + call36a(make36a()); }
function A37t() { }
A37t.prototype.m = function (x) { calls++; return 'A37t.m' + x; };
function C37t() { this.v = 37; }
C37t.prototype = Object.create(A37t.prototype);
C37t.prototype.constructor = C37t;
C37t.prototype.own = function (x) { calls++; return 'C37t.own' + x + this.v; };
function make37t() { const o = new C37t(); escape(o); return o; }
function run37t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C37t.prototype, A37t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A37l() { }
A37l.prototype.m = function (x) { calls++; return 'A37l.m' + x; };
function C37l() { this.v = 37; }
C37l.prototype = Object.create(A37l.prototype);
C37l.prototype.constructor = C37l;
C37l.prototype.own = function (x) { calls++; return 'C37l.own' + x + this.v; };
function make37l() { const o = new C37l(); escape(o); return o; }
function run37l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C37l.prototype, A37l.prototype); s += o.m(i) + ';'; } return s; }
function A37f() { }
A37f.prototype.m = function (x) { calls++; return 'A37f.m' + x; };
function C37f() { this.v = 37; }
C37f.prototype = Object.create(A37f.prototype);
C37f.prototype.constructor = C37f;
C37f.prototype.own = function (x) { calls++; return 'C37f.own' + x + this.v; };
function make37f() { const o = new C37f(); escape(o); return o; }
function call37f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run37f(o, hook) { hook(o, C37f.prototype, A37f.prototype); return call37f(o); }
function A37a() { }
A37a.prototype.m = function (x) { calls++; return 'A37a.m' + x; };
function C37a() { this.v = 37; }
C37a.prototype = Object.create(A37a.prototype);
C37a.prototype.constructor = C37a;
C37a.prototype.own = function (x) { calls++; return 'C37a.own' + x + this.v; };
function make37a() { const o = new C37a(); escape(o); return o; }
function call37a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run37a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call37a(o); hook(o, C37a.prototype, A37a.prototype); return s + '|' + call37a(o) + '|' + call37a(make37a()); }
function A38t() { }
A38t.prototype.m = function (x) { calls++; return 'A38t.m' + x; };
function C38t() { this.v = 38; }
C38t.prototype = Object.create(A38t.prototype);
C38t.prototype.constructor = C38t;
C38t.prototype.own = function (x) { calls++; return 'C38t.own' + x + this.v; };
function make38t() { const o = new C38t(); escape(o); return o; }
function run38t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C38t.prototype, A38t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A38l() { }
A38l.prototype.m = function (x) { calls++; return 'A38l.m' + x; };
function C38l() { this.v = 38; }
C38l.prototype = Object.create(A38l.prototype);
C38l.prototype.constructor = C38l;
C38l.prototype.own = function (x) { calls++; return 'C38l.own' + x + this.v; };
function make38l() { const o = new C38l(); escape(o); return o; }
function run38l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C38l.prototype, A38l.prototype); s += o.m(i) + ';'; } return s; }
function A38f() { }
A38f.prototype.m = function (x) { calls++; return 'A38f.m' + x; };
function C38f() { this.v = 38; }
C38f.prototype = Object.create(A38f.prototype);
C38f.prototype.constructor = C38f;
C38f.prototype.own = function (x) { calls++; return 'C38f.own' + x + this.v; };
function make38f() { const o = new C38f(); escape(o); return o; }
function call38f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run38f(o, hook) { hook(o, C38f.prototype, A38f.prototype); return call38f(o); }
function A38a() { }
A38a.prototype.m = function (x) { calls++; return 'A38a.m' + x; };
function C38a() { this.v = 38; }
C38a.prototype = Object.create(A38a.prototype);
C38a.prototype.constructor = C38a;
C38a.prototype.own = function (x) { calls++; return 'C38a.own' + x + this.v; };
function make38a() { const o = new C38a(); escape(o); return o; }
function call38a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run38a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call38a(o); hook(o, C38a.prototype, A38a.prototype); return s + '|' + call38a(o) + '|' + call38a(make38a()); }
function A39t() { }
A39t.prototype.m = function (x) { calls++; return 'A39t.m' + x; };
function C39t() { this.v = 39; }
C39t.prototype = Object.create(A39t.prototype);
C39t.prototype.constructor = C39t;
C39t.prototype.own = function (x) { calls++; return 'C39t.own' + x + this.v; };
function make39t() { const o = new C39t(); escape(o); return o; }
function run39t(o, hook) { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C39t.prototype, A39t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
function A39l() { }
A39l.prototype.m = function (x) { calls++; return 'A39l.m' + x; };
function C39l() { this.v = 39; }
C39l.prototype = Object.create(A39l.prototype);
C39l.prototype.constructor = C39l;
C39l.prototype.own = function (x) { calls++; return 'C39l.own' + x + this.v; };
function make39l() { const o = new C39l(); escape(o); return o; }
function run39l(o, hook) { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C39l.prototype, A39l.prototype); s += o.m(i) + ';'; } return s; }
function A39f() { }
A39f.prototype.m = function (x) { calls++; return 'A39f.m' + x; };
function C39f() { this.v = 39; }
C39f.prototype = Object.create(A39f.prototype);
C39f.prototype.constructor = C39f;
C39f.prototype.own = function (x) { calls++; return 'C39f.own' + x + this.v; };
function make39f() { const o = new C39f(); escape(o); return o; }
function call39f(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run39f(o, hook) { hook(o, C39f.prototype, A39f.prototype); return call39f(o); }
function A39a() { }
A39a.prototype.m = function (x) { calls++; return 'A39a.m' + x; };
function C39a() { this.v = 39; }
C39a.prototype = Object.create(A39a.prototype);
C39a.prototype.constructor = C39a;
C39a.prototype.own = function (x) { calls++; return 'C39a.own' + x + this.v; };
function make39a() { const o = new C39a(); escape(o); return o; }
function call39a(o) { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run39a(o, hook) { let s = ''; for (let i = 0; i < 3; i++) s += call39a(o); hook(o, C39a.prototype, A39a.prototype); return s + '|' + call39a(o) + '|' + call39a(make39a()); }
console.log('nothing', attempt(() => run0t(make0t(), hooks[0])), attempt(() => run0l(make0l(), hooks[0])), attempt(() => run0f(make0f(), hooks[0])), attempt(() => run0a(make0a(), hooks[0])));
console.log('own class: assigned', attempt(() => run1t(make1t(), hooks[1])), attempt(() => run1l(make1l(), hooks[1])), attempt(() => run1f(make1f(), hooks[1])), attempt(() => run1a(make1a(), hooks[1])));
console.log('class above: assigned', attempt(() => run2t(make2t(), hooks[2])), attempt(() => run2l(make2l(), hooks[2])), attempt(() => run2f(make2f(), hooks[2])), attempt(() => run2a(make2a(), hooks[2])));
console.log('own class: added over the one above', attempt(() => run3t(make3t(), hooks[3])), attempt(() => run3l(make3l(), hooks[3])), attempt(() => run3f(make3f(), hooks[3])), attempt(() => run3a(make3a(), hooks[3])));
console.log('own class: a getter', attempt(() => run4t(make4t(), hooks[4])), attempt(() => run4l(make4l(), hooks[4])), attempt(() => run4f(make4f(), hooks[4])), attempt(() => run4a(make4a(), hooks[4])));
console.log('class above: a getter', attempt(() => run5t(make5t(), hooks[5])), attempt(() => run5l(make5l(), hooks[5])), attempt(() => run5f(make5f(), hooks[5])), attempt(() => run5a(make5a(), hooks[5])));
console.log('own class: a getter over the one above', attempt(() => run6t(make6t(), hooks[6])), attempt(() => run6l(make6l(), hooks[6])), attempt(() => run6f(make6f(), hooks[6])), attempt(() => run6a(make6a(), hooks[6])));
console.log('own class: deleted', attempt(() => run7t(make7t(), hooks[7])), attempt(() => run7l(make7l(), hooks[7])), attempt(() => run7f(make7f(), hooks[7])), attempt(() => run7a(make7a(), hooks[7])));
console.log('class above: deleted', attempt(() => run8t(make8t(), hooks[8])), attempt(() => run8l(make8l(), hooks[8])), attempt(() => run8f(make8f(), hooks[8])), attempt(() => run8a(make8a(), hooks[8])));
console.log('instance: assigned', attempt(() => run9t(make9t(), hooks[9])), attempt(() => run9l(make9l(), hooks[9])), attempt(() => run9f(make9f(), hooks[9])), attempt(() => run9a(make9a(), hooks[9])));
console.log('instance: assigned over the one above', attempt(() => run10t(make10t(), hooks[10])), attempt(() => run10l(make10l(), hooks[10])), attempt(() => run10f(make10f(), hooks[10])), attempt(() => run10a(make10a(), hooks[10])));
console.log('instance: defined', attempt(() => run11t(make11t(), hooks[11])), attempt(() => run11l(make11l(), hooks[11])), attempt(() => run11f(make11f(), hooks[11])), attempt(() => run11a(make11a(), hooks[11])));
console.log('instance: a getter', attempt(() => run12t(make12t(), hooks[12])), attempt(() => run12l(make12l(), hooks[12])), attempt(() => run12f(make12f(), hooks[12])), attempt(() => run12a(make12a(), hooks[12])));
console.log('instance: copied onto', attempt(() => run13t(make13t(), hooks[13])), attempt(() => run13l(make13l(), hooks[13])), attempt(() => run13f(make13f(), hooks[13])), attempt(() => run13a(make13a(), hooks[13])));
console.log('instance: under a computed key', attempt(() => run14t(make14t(), hooks[14])), attempt(() => run14l(make14l(), hooks[14])), attempt(() => run14f(make14f(), hooks[14])), attempt(() => run14a(make14a(), hooks[14])));
console.log('own class: under a computed key', attempt(() => run15t(make15t(), hooks[15])), attempt(() => run15l(make15l(), hooks[15])), attempt(() => run15f(make15f(), hooks[15])), attempt(() => run15a(make15a(), hooks[15])));
console.log('class above: under a computed key', attempt(() => run16t(make16t(), hooks[16])), attempt(() => run16l(make16l(), hooks[16])), attempt(() => run16f(make16f(), hooks[16])), attempt(() => run16a(make16a(), hooks[16])));
console.log('instance: another prototype', attempt(() => run17t(make17t(), hooks[17])), attempt(() => run17l(make17l(), hooks[17])), attempt(() => run17f(make17f(), hooks[17])), attempt(() => run17a(make17a(), hooks[17])));
console.log('instance: no prototype', attempt(() => run18t(make18t(), hooks[18])), attempt(() => run18l(make18l(), hooks[18])), attempt(() => run18f(make18f(), hooks[18])), attempt(() => run18a(make18a(), hooks[18])));
console.log('instance: an object below its class', attempt(() => run19t(make19t(), hooks[19])), attempt(() => run19l(make19l(), hooks[19])), attempt(() => run19f(make19f(), hooks[19])), attempt(() => run19a(make19a(), hooks[19])));
console.log('instance: an object below its class that hides', attempt(() => run20t(make20t(), hooks[20])), attempt(() => run20l(make20l(), hooks[20])), attempt(() => run20f(make20f(), hooks[20])), attempt(() => run20a(make20a(), hooks[20])));
console.log('instance: the class above', attempt(() => run21t(make21t(), hooks[21])), attempt(() => run21l(make21l(), hooks[21])), attempt(() => run21f(make21f(), hooks[21])), attempt(() => run21a(make21a(), hooks[21])));
console.log('instance: __proto__', attempt(() => run22t(make22t(), hooks[22])), attempt(() => run22l(make22l(), hooks[22])), attempt(() => run22f(make22f(), hooks[22])), attempt(() => run22a(make22a(), hooks[22])));
console.log('own class: another parent', attempt(() => run23t(make23t(), hooks[23])), attempt(() => run23l(make23l(), hooks[23])), attempt(() => run23f(make23f(), hooks[23])), attempt(() => run23a(make23a(), hooks[23])));
console.log('own class: no parent', attempt(() => run24t(make24t(), hooks[24])), attempt(() => run24l(make24l(), hooks[24])), attempt(() => run24f(make24f(), hooks[24])), attempt(() => run24a(make24a(), hooks[24])));
console.log('own class: __proto__', attempt(() => run25t(make25t(), hooks[25])), attempt(() => run25l(make25l(), hooks[25])), attempt(() => run25f(make25f(), hooks[25])), attempt(() => run25a(make25a(), hooks[25])));
console.log('class above: another parent', attempt(() => run26t(make26t(), hooks[26])), attempt(() => run26l(make26l(), hooks[26])), attempt(() => run26f(make26f(), hooks[26])), attempt(() => run26a(make26a(), hooks[26])));
console.log('own class: Reflect.set', attempt(() => run27t(make27t(), hooks[27])), attempt(() => run27l(make27l(), hooks[27])), attempt(() => run27f(make27f(), hooks[27])), attempt(() => run27a(make27a(), hooks[27])));
console.log('class above: Reflect.defineProperty', attempt(() => run28t(make28t(), hooks[28])), attempt(() => run28l(make28l(), hooks[28])), attempt(() => run28f(make28f(), hooks[28])), attempt(() => run28a(make28a(), hooks[28])));
console.log('own class: the same again', attempt(() => run29t(make29t(), hooks[29])), attempt(() => run29l(make29l(), hooks[29])), attempt(() => run29f(make29f(), hooks[29])), attempt(() => run29a(make29a(), hooks[29])));
console.log('own class: frozen', attempt(() => run30t(make30t(), hooks[30])), attempt(() => run30l(make30l(), hooks[30])), attempt(() => run30f(make30f(), hooks[30])), attempt(() => run30a(make30a(), hooks[30])));
console.log('own class: no function', attempt(() => run31t(make31t(), hooks[31])), attempt(() => run31l(make31l(), hooks[31])), attempt(() => run31f(make31f(), hooks[31])), attempt(() => run31a(make31a(), hooks[31])));
console.log('class above: undefined', attempt(() => run32t(make32t(), hooks[32])), attempt(() => run32l(make32l(), hooks[32])), attempt(() => run32f(make32f(), hooks[32])), attempt(() => run32a(make32a(), hooks[32])));
console.log('own class: read only', attempt(() => run33t(make33t(), hooks[33])), attempt(() => run33l(make33l(), hooks[33])), attempt(() => run33f(make33f(), hooks[33])), attempt(() => run33a(make33a(), hooks[33])));
console.log('another instance: assigned', attempt(() => run34t(make34t(), hooks[34])), attempt(() => run34l(make34l(), hooks[34])), attempt(() => run34f(make34f(), hooks[34])), attempt(() => run34a(make34a(), hooks[34])));
console.log('instance: assigned and deleted', attempt(() => run35t(make35t(), hooks[35])), attempt(() => run35l(make35l(), hooks[35])), attempt(() => run35f(make35f(), hooks[35])), attempt(() => run35a(make35a(), hooks[35])));
console.log('own class: assigned and put back', attempt(() => run36t(make36t(), hooks[36])), attempt(() => run36l(make36l(), hooks[36])), attempt(() => run36f(make36f(), hooks[36])), attempt(() => run36a(make36a(), hooks[36])));
console.log('own class: a bound function of the same', attempt(() => run37t(make37t(), hooks[37])), attempt(() => run37l(make37l(), hooks[37])), attempt(() => run37f(make37f(), hooks[37])), attempt(() => run37a(make37a(), hooks[37])));
console.log('instance: frozen', attempt(() => run38t(make38t(), hooks[38])), attempt(() => run38l(make38l(), hooks[38])), attempt(() => run38f(make38f(), hooks[38])), attempt(() => run38a(make38a(), hooks[38])));
console.log('instance: other properties', attempt(() => run39t(make39t(), hooks[39])), attempt(() => run39l(make39l(), hooks[39])), attempt(() => run39f(make39f(), hooks[39])), attempt(() => run39a(make39a(), hooks[39])));
