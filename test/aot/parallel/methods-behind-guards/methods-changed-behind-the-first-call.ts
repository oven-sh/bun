// `o.m()` in a loop, on an object that unseen code has in hand. What the class wrote under the name is called directly only while it still lies there, nothing hides it and the object still stands below its class.
// Each change has classes of its own for each shape of site: a guard that has ended stays ended. Every call stands in a loop, where the guarded call is built. Written by a generator: the text is the test.
let log = '', calls = 0;
const sink: unknown[] = []; (globalThis as any).sinkOfMethods = sink;
function escape<T>(o: T): T { sink.push(o); sink.length = 0; return o; }
const nameOfOwn = ['o', 'w', 'n'].join(''), nameOfM = String.fromCharCode(109);
function attempt(run: () => string): string { log = ''; calls = 0; try { return run() + ' [' + log + calls + ']'; } catch (e) { return (e instanceof TypeError ? 'TypeError' : 'other ' + e) + ' [' + log + calls + ']'; } }
type Hook = (o: any, own: any, above: any) => void;
const hooks: Hook[] = [
  (o, own, above) => { },
  (o, own, above) => { own.own = function (x: number) { return 'assigned own' + x; }; },
  (o, own, above) => { above.m = function (x: number) { return 'assigned m' + x; }; },
  (o, own, above) => { own.m = function (x: number) { return 'added m' + x; }; },
  (o, own, above) => { Object.defineProperty(own, 'own', { get() { log += 'g'; return (x: number) => 'getter own' + x; }, configurable: true }); },
  (o, own, above) => { Object.defineProperty(above, 'm', { get() { log += 'G'; return (x: number) => 'getter m' + x; }, configurable: true }); },
  (o, own, above) => { Object.defineProperty(own, 'm', { get() { log += 'h'; return (x: number) => 'getter between' + x; }, configurable: true }); },
  (o, own, above) => { delete own.own; },
  (o, own, above) => { delete above.m; },
  (o, own, above) => { o.own = (x: number) => 'instance own' + x; },
  (o, own, above) => { o.m = (x: number) => 'instance m' + x; },
  (o, own, above) => { Object.defineProperty(o, 'own', { value: (x: number) => 'defined own' + x, configurable: true }); },
  (o, own, above) => { Object.defineProperty(o, 'm', { get() { log += 'i'; return (x: number) => 'instance getter m' + x; }, configurable: true }); },
  (o, own, above) => { Object.assign(o, { own: (x: number) => 'copied own' + x, m: (x: number) => 'copied m' + x }); },
  (o, own, above) => { o[nameOfOwn] = (x: number) => 'computed own' + x; o[nameOfM] = (x: number) => 'computed m' + x; },
  (o, own, above) => { own[nameOfOwn] = (x: number) => 'computed on class' + x; },
  (o, own, above) => { above[nameOfM] = (x: number) => 'computed above' + x; },
  (o, own, above) => { Object.setPrototypeOf(o, { own(x: number) { return 'other own' + x; }, m(x: number) { return 'other m' + x; } }); },
  (o, own, above) => { Object.setPrototypeOf(o, null); },
  (o, own, above) => { Object.setPrototypeOf(o, Object.create(own)); },
  (o, own, above) => { Object.setPrototypeOf(o, Object.create(own, { m: { value: (x: number) => 'hidden m' + x } })); },
  (o, own, above) => { Object.setPrototypeOf(o, above); },
  (o, own, above) => { o.__proto__ = { own: (x: number) => 'proto own' + x, m: (x: number) => 'proto m' + x }; },
  (o, own, above) => { Object.setPrototypeOf(own, { m(x: number) { return 'other parent m' + x; } }); },
  (o, own, above) => { Object.setPrototypeOf(own, null); },
  (o, own, above) => { own.__proto__ = { m: (x: number) => 'proto parent m' + x }; },
  (o, own, above) => { Object.setPrototypeOf(above, { own() { return 'never'; }, m() { return 'never'; } }); },
  (o, own, above) => { Reflect.set(own, 'own', (x: number) => 'reflected own' + x); },
  (o, own, above) => { Reflect.defineProperty(above, 'm', { value: (x: number) => 'reflected m' + x }); },
  (o, own, above) => { own.own = own.own; above.m = above.m; },
  (o, own, above) => { Object.freeze(own); Object.freeze(above); },
  (o, own, above) => { own.own = 5; },
  (o, own, above) => { above.m = undefined; },
  (o, own, above) => { Object.defineProperty(own, 'own', { value: (x: number) => 'read only own' + x, writable: false }); },
  (o, own, above) => { const other = Object.create(own); other.own = () => 'of another'; other.m = () => 'of another'; },
  (o, own, above) => { o.own = () => 'gone'; delete o.own; o.m = () => 'gone'; delete o.m; },
  (o, own, above) => { const was = own.own; own.own = () => 'gone'; own.own = was; },
  (o, own, above) => { own.own = own.own.bind({ v: 'bound' }); },
  (o, own, above) => { Object.freeze(o); },
  (o, own, above) => { o.other = 1; o.more = 2; delete o.v; },
];
class A0t { m(x: number): string { calls++; return 'A0t.m' + x; } }
class C0t extends A0t { v: unknown = 0; own(x: number): string { calls++; return 'C0t.own' + x + this.v; } }
function run0t(o: C0t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C0t.prototype, A0t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A0l { m(x: number): string { calls++; return 'A0l.m' + x; } }
class C0l extends A0l { v: unknown = 0; own(x: number): string { calls++; return 'C0l.own' + x + this.v; } }
function run0l(o: C0l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C0l.prototype, A0l.prototype); s += o.m(i) + ';'; } return s; }
class A0f { m(x: number): string { calls++; return 'A0f.m' + x; } }
class C0f extends A0f { v: unknown = 0; own(x: number): string { calls++; return 'C0f.own' + x + this.v; } }
function call0f(o: C0f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run0f(o: C0f, hook: Hook): string { hook(o, C0f.prototype, A0f.prototype); return call0f(o); }
class A0a { m(x: number): string { calls++; return 'A0a.m' + x; } }
class C0a extends A0a { v: unknown = 0; own(x: number): string { calls++; return 'C0a.own' + x + this.v; } }
function call0a(o: C0a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run0a(o: C0a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call0a(o); hook(o, C0a.prototype, A0a.prototype); return s + '|' + call0a(o) + '|' + call0a(escape(new C0a())); }
class A1t { m(x: number): string { calls++; return 'A1t.m' + x; } }
class C1t extends A1t { v: unknown = 1; own(x: number): string { calls++; return 'C1t.own' + x + this.v; } }
function run1t(o: C1t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C1t.prototype, A1t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A1l { m(x: number): string { calls++; return 'A1l.m' + x; } }
class C1l extends A1l { v: unknown = 1; own(x: number): string { calls++; return 'C1l.own' + x + this.v; } }
function run1l(o: C1l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C1l.prototype, A1l.prototype); s += o.m(i) + ';'; } return s; }
class A1f { m(x: number): string { calls++; return 'A1f.m' + x; } }
class C1f extends A1f { v: unknown = 1; own(x: number): string { calls++; return 'C1f.own' + x + this.v; } }
function call1f(o: C1f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run1f(o: C1f, hook: Hook): string { hook(o, C1f.prototype, A1f.prototype); return call1f(o); }
class A1a { m(x: number): string { calls++; return 'A1a.m' + x; } }
class C1a extends A1a { v: unknown = 1; own(x: number): string { calls++; return 'C1a.own' + x + this.v; } }
function call1a(o: C1a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run1a(o: C1a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call1a(o); hook(o, C1a.prototype, A1a.prototype); return s + '|' + call1a(o) + '|' + call1a(escape(new C1a())); }
class A2t { m(x: number): string { calls++; return 'A2t.m' + x; } }
class C2t extends A2t { v: unknown = 2; own(x: number): string { calls++; return 'C2t.own' + x + this.v; } }
function run2t(o: C2t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C2t.prototype, A2t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A2l { m(x: number): string { calls++; return 'A2l.m' + x; } }
class C2l extends A2l { v: unknown = 2; own(x: number): string { calls++; return 'C2l.own' + x + this.v; } }
function run2l(o: C2l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C2l.prototype, A2l.prototype); s += o.m(i) + ';'; } return s; }
class A2f { m(x: number): string { calls++; return 'A2f.m' + x; } }
class C2f extends A2f { v: unknown = 2; own(x: number): string { calls++; return 'C2f.own' + x + this.v; } }
function call2f(o: C2f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run2f(o: C2f, hook: Hook): string { hook(o, C2f.prototype, A2f.prototype); return call2f(o); }
class A2a { m(x: number): string { calls++; return 'A2a.m' + x; } }
class C2a extends A2a { v: unknown = 2; own(x: number): string { calls++; return 'C2a.own' + x + this.v; } }
function call2a(o: C2a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run2a(o: C2a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call2a(o); hook(o, C2a.prototype, A2a.prototype); return s + '|' + call2a(o) + '|' + call2a(escape(new C2a())); }
class A3t { m(x: number): string { calls++; return 'A3t.m' + x; } }
class C3t extends A3t { v: unknown = 3; own(x: number): string { calls++; return 'C3t.own' + x + this.v; } }
function run3t(o: C3t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C3t.prototype, A3t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A3l { m(x: number): string { calls++; return 'A3l.m' + x; } }
class C3l extends A3l { v: unknown = 3; own(x: number): string { calls++; return 'C3l.own' + x + this.v; } }
function run3l(o: C3l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C3l.prototype, A3l.prototype); s += o.m(i) + ';'; } return s; }
class A3f { m(x: number): string { calls++; return 'A3f.m' + x; } }
class C3f extends A3f { v: unknown = 3; own(x: number): string { calls++; return 'C3f.own' + x + this.v; } }
function call3f(o: C3f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run3f(o: C3f, hook: Hook): string { hook(o, C3f.prototype, A3f.prototype); return call3f(o); }
class A3a { m(x: number): string { calls++; return 'A3a.m' + x; } }
class C3a extends A3a { v: unknown = 3; own(x: number): string { calls++; return 'C3a.own' + x + this.v; } }
function call3a(o: C3a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run3a(o: C3a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call3a(o); hook(o, C3a.prototype, A3a.prototype); return s + '|' + call3a(o) + '|' + call3a(escape(new C3a())); }
class A4t { m(x: number): string { calls++; return 'A4t.m' + x; } }
class C4t extends A4t { v: unknown = 4; own(x: number): string { calls++; return 'C4t.own' + x + this.v; } }
function run4t(o: C4t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C4t.prototype, A4t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A4l { m(x: number): string { calls++; return 'A4l.m' + x; } }
class C4l extends A4l { v: unknown = 4; own(x: number): string { calls++; return 'C4l.own' + x + this.v; } }
function run4l(o: C4l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C4l.prototype, A4l.prototype); s += o.m(i) + ';'; } return s; }
class A4f { m(x: number): string { calls++; return 'A4f.m' + x; } }
class C4f extends A4f { v: unknown = 4; own(x: number): string { calls++; return 'C4f.own' + x + this.v; } }
function call4f(o: C4f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run4f(o: C4f, hook: Hook): string { hook(o, C4f.prototype, A4f.prototype); return call4f(o); }
class A4a { m(x: number): string { calls++; return 'A4a.m' + x; } }
class C4a extends A4a { v: unknown = 4; own(x: number): string { calls++; return 'C4a.own' + x + this.v; } }
function call4a(o: C4a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run4a(o: C4a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call4a(o); hook(o, C4a.prototype, A4a.prototype); return s + '|' + call4a(o) + '|' + call4a(escape(new C4a())); }
class A5t { m(x: number): string { calls++; return 'A5t.m' + x; } }
class C5t extends A5t { v: unknown = 5; own(x: number): string { calls++; return 'C5t.own' + x + this.v; } }
function run5t(o: C5t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C5t.prototype, A5t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A5l { m(x: number): string { calls++; return 'A5l.m' + x; } }
class C5l extends A5l { v: unknown = 5; own(x: number): string { calls++; return 'C5l.own' + x + this.v; } }
function run5l(o: C5l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C5l.prototype, A5l.prototype); s += o.m(i) + ';'; } return s; }
class A5f { m(x: number): string { calls++; return 'A5f.m' + x; } }
class C5f extends A5f { v: unknown = 5; own(x: number): string { calls++; return 'C5f.own' + x + this.v; } }
function call5f(o: C5f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run5f(o: C5f, hook: Hook): string { hook(o, C5f.prototype, A5f.prototype); return call5f(o); }
class A5a { m(x: number): string { calls++; return 'A5a.m' + x; } }
class C5a extends A5a { v: unknown = 5; own(x: number): string { calls++; return 'C5a.own' + x + this.v; } }
function call5a(o: C5a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run5a(o: C5a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call5a(o); hook(o, C5a.prototype, A5a.prototype); return s + '|' + call5a(o) + '|' + call5a(escape(new C5a())); }
class A6t { m(x: number): string { calls++; return 'A6t.m' + x; } }
class C6t extends A6t { v: unknown = 6; own(x: number): string { calls++; return 'C6t.own' + x + this.v; } }
function run6t(o: C6t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C6t.prototype, A6t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A6l { m(x: number): string { calls++; return 'A6l.m' + x; } }
class C6l extends A6l { v: unknown = 6; own(x: number): string { calls++; return 'C6l.own' + x + this.v; } }
function run6l(o: C6l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C6l.prototype, A6l.prototype); s += o.m(i) + ';'; } return s; }
class A6f { m(x: number): string { calls++; return 'A6f.m' + x; } }
class C6f extends A6f { v: unknown = 6; own(x: number): string { calls++; return 'C6f.own' + x + this.v; } }
function call6f(o: C6f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run6f(o: C6f, hook: Hook): string { hook(o, C6f.prototype, A6f.prototype); return call6f(o); }
class A6a { m(x: number): string { calls++; return 'A6a.m' + x; } }
class C6a extends A6a { v: unknown = 6; own(x: number): string { calls++; return 'C6a.own' + x + this.v; } }
function call6a(o: C6a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run6a(o: C6a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call6a(o); hook(o, C6a.prototype, A6a.prototype); return s + '|' + call6a(o) + '|' + call6a(escape(new C6a())); }
class A7t { m(x: number): string { calls++; return 'A7t.m' + x; } }
class C7t extends A7t { v: unknown = 7; own(x: number): string { calls++; return 'C7t.own' + x + this.v; } }
function run7t(o: C7t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C7t.prototype, A7t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A7l { m(x: number): string { calls++; return 'A7l.m' + x; } }
class C7l extends A7l { v: unknown = 7; own(x: number): string { calls++; return 'C7l.own' + x + this.v; } }
function run7l(o: C7l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C7l.prototype, A7l.prototype); s += o.m(i) + ';'; } return s; }
class A7f { m(x: number): string { calls++; return 'A7f.m' + x; } }
class C7f extends A7f { v: unknown = 7; own(x: number): string { calls++; return 'C7f.own' + x + this.v; } }
function call7f(o: C7f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run7f(o: C7f, hook: Hook): string { hook(o, C7f.prototype, A7f.prototype); return call7f(o); }
class A7a { m(x: number): string { calls++; return 'A7a.m' + x; } }
class C7a extends A7a { v: unknown = 7; own(x: number): string { calls++; return 'C7a.own' + x + this.v; } }
function call7a(o: C7a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run7a(o: C7a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call7a(o); hook(o, C7a.prototype, A7a.prototype); return s + '|' + call7a(o) + '|' + call7a(escape(new C7a())); }
class A8t { m(x: number): string { calls++; return 'A8t.m' + x; } }
class C8t extends A8t { v: unknown = 8; own(x: number): string { calls++; return 'C8t.own' + x + this.v; } }
function run8t(o: C8t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C8t.prototype, A8t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A8l { m(x: number): string { calls++; return 'A8l.m' + x; } }
class C8l extends A8l { v: unknown = 8; own(x: number): string { calls++; return 'C8l.own' + x + this.v; } }
function run8l(o: C8l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C8l.prototype, A8l.prototype); s += o.m(i) + ';'; } return s; }
class A8f { m(x: number): string { calls++; return 'A8f.m' + x; } }
class C8f extends A8f { v: unknown = 8; own(x: number): string { calls++; return 'C8f.own' + x + this.v; } }
function call8f(o: C8f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run8f(o: C8f, hook: Hook): string { hook(o, C8f.prototype, A8f.prototype); return call8f(o); }
class A8a { m(x: number): string { calls++; return 'A8a.m' + x; } }
class C8a extends A8a { v: unknown = 8; own(x: number): string { calls++; return 'C8a.own' + x + this.v; } }
function call8a(o: C8a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run8a(o: C8a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call8a(o); hook(o, C8a.prototype, A8a.prototype); return s + '|' + call8a(o) + '|' + call8a(escape(new C8a())); }
class A9t { m(x: number): string { calls++; return 'A9t.m' + x; } }
class C9t extends A9t { v: unknown = 9; own(x: number): string { calls++; return 'C9t.own' + x + this.v; } }
function run9t(o: C9t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C9t.prototype, A9t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A9l { m(x: number): string { calls++; return 'A9l.m' + x; } }
class C9l extends A9l { v: unknown = 9; own(x: number): string { calls++; return 'C9l.own' + x + this.v; } }
function run9l(o: C9l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C9l.prototype, A9l.prototype); s += o.m(i) + ';'; } return s; }
class A9f { m(x: number): string { calls++; return 'A9f.m' + x; } }
class C9f extends A9f { v: unknown = 9; own(x: number): string { calls++; return 'C9f.own' + x + this.v; } }
function call9f(o: C9f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run9f(o: C9f, hook: Hook): string { hook(o, C9f.prototype, A9f.prototype); return call9f(o); }
class A9a { m(x: number): string { calls++; return 'A9a.m' + x; } }
class C9a extends A9a { v: unknown = 9; own(x: number): string { calls++; return 'C9a.own' + x + this.v; } }
function call9a(o: C9a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run9a(o: C9a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call9a(o); hook(o, C9a.prototype, A9a.prototype); return s + '|' + call9a(o) + '|' + call9a(escape(new C9a())); }
class A10t { m(x: number): string { calls++; return 'A10t.m' + x; } }
class C10t extends A10t { v: unknown = 10; own(x: number): string { calls++; return 'C10t.own' + x + this.v; } }
function run10t(o: C10t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C10t.prototype, A10t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A10l { m(x: number): string { calls++; return 'A10l.m' + x; } }
class C10l extends A10l { v: unknown = 10; own(x: number): string { calls++; return 'C10l.own' + x + this.v; } }
function run10l(o: C10l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C10l.prototype, A10l.prototype); s += o.m(i) + ';'; } return s; }
class A10f { m(x: number): string { calls++; return 'A10f.m' + x; } }
class C10f extends A10f { v: unknown = 10; own(x: number): string { calls++; return 'C10f.own' + x + this.v; } }
function call10f(o: C10f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run10f(o: C10f, hook: Hook): string { hook(o, C10f.prototype, A10f.prototype); return call10f(o); }
class A10a { m(x: number): string { calls++; return 'A10a.m' + x; } }
class C10a extends A10a { v: unknown = 10; own(x: number): string { calls++; return 'C10a.own' + x + this.v; } }
function call10a(o: C10a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run10a(o: C10a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call10a(o); hook(o, C10a.prototype, A10a.prototype); return s + '|' + call10a(o) + '|' + call10a(escape(new C10a())); }
class A11t { m(x: number): string { calls++; return 'A11t.m' + x; } }
class C11t extends A11t { v: unknown = 11; own(x: number): string { calls++; return 'C11t.own' + x + this.v; } }
function run11t(o: C11t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C11t.prototype, A11t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A11l { m(x: number): string { calls++; return 'A11l.m' + x; } }
class C11l extends A11l { v: unknown = 11; own(x: number): string { calls++; return 'C11l.own' + x + this.v; } }
function run11l(o: C11l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C11l.prototype, A11l.prototype); s += o.m(i) + ';'; } return s; }
class A11f { m(x: number): string { calls++; return 'A11f.m' + x; } }
class C11f extends A11f { v: unknown = 11; own(x: number): string { calls++; return 'C11f.own' + x + this.v; } }
function call11f(o: C11f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run11f(o: C11f, hook: Hook): string { hook(o, C11f.prototype, A11f.prototype); return call11f(o); }
class A11a { m(x: number): string { calls++; return 'A11a.m' + x; } }
class C11a extends A11a { v: unknown = 11; own(x: number): string { calls++; return 'C11a.own' + x + this.v; } }
function call11a(o: C11a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run11a(o: C11a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call11a(o); hook(o, C11a.prototype, A11a.prototype); return s + '|' + call11a(o) + '|' + call11a(escape(new C11a())); }
class A12t { m(x: number): string { calls++; return 'A12t.m' + x; } }
class C12t extends A12t { v: unknown = 12; own(x: number): string { calls++; return 'C12t.own' + x + this.v; } }
function run12t(o: C12t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C12t.prototype, A12t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A12l { m(x: number): string { calls++; return 'A12l.m' + x; } }
class C12l extends A12l { v: unknown = 12; own(x: number): string { calls++; return 'C12l.own' + x + this.v; } }
function run12l(o: C12l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C12l.prototype, A12l.prototype); s += o.m(i) + ';'; } return s; }
class A12f { m(x: number): string { calls++; return 'A12f.m' + x; } }
class C12f extends A12f { v: unknown = 12; own(x: number): string { calls++; return 'C12f.own' + x + this.v; } }
function call12f(o: C12f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run12f(o: C12f, hook: Hook): string { hook(o, C12f.prototype, A12f.prototype); return call12f(o); }
class A12a { m(x: number): string { calls++; return 'A12a.m' + x; } }
class C12a extends A12a { v: unknown = 12; own(x: number): string { calls++; return 'C12a.own' + x + this.v; } }
function call12a(o: C12a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run12a(o: C12a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call12a(o); hook(o, C12a.prototype, A12a.prototype); return s + '|' + call12a(o) + '|' + call12a(escape(new C12a())); }
class A13t { m(x: number): string { calls++; return 'A13t.m' + x; } }
class C13t extends A13t { v: unknown = 13; own(x: number): string { calls++; return 'C13t.own' + x + this.v; } }
function run13t(o: C13t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C13t.prototype, A13t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A13l { m(x: number): string { calls++; return 'A13l.m' + x; } }
class C13l extends A13l { v: unknown = 13; own(x: number): string { calls++; return 'C13l.own' + x + this.v; } }
function run13l(o: C13l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C13l.prototype, A13l.prototype); s += o.m(i) + ';'; } return s; }
class A13f { m(x: number): string { calls++; return 'A13f.m' + x; } }
class C13f extends A13f { v: unknown = 13; own(x: number): string { calls++; return 'C13f.own' + x + this.v; } }
function call13f(o: C13f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run13f(o: C13f, hook: Hook): string { hook(o, C13f.prototype, A13f.prototype); return call13f(o); }
class A13a { m(x: number): string { calls++; return 'A13a.m' + x; } }
class C13a extends A13a { v: unknown = 13; own(x: number): string { calls++; return 'C13a.own' + x + this.v; } }
function call13a(o: C13a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run13a(o: C13a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call13a(o); hook(o, C13a.prototype, A13a.prototype); return s + '|' + call13a(o) + '|' + call13a(escape(new C13a())); }
class A14t { m(x: number): string { calls++; return 'A14t.m' + x; } }
class C14t extends A14t { v: unknown = 14; own(x: number): string { calls++; return 'C14t.own' + x + this.v; } }
function run14t(o: C14t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C14t.prototype, A14t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A14l { m(x: number): string { calls++; return 'A14l.m' + x; } }
class C14l extends A14l { v: unknown = 14; own(x: number): string { calls++; return 'C14l.own' + x + this.v; } }
function run14l(o: C14l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C14l.prototype, A14l.prototype); s += o.m(i) + ';'; } return s; }
class A14f { m(x: number): string { calls++; return 'A14f.m' + x; } }
class C14f extends A14f { v: unknown = 14; own(x: number): string { calls++; return 'C14f.own' + x + this.v; } }
function call14f(o: C14f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run14f(o: C14f, hook: Hook): string { hook(o, C14f.prototype, A14f.prototype); return call14f(o); }
class A14a { m(x: number): string { calls++; return 'A14a.m' + x; } }
class C14a extends A14a { v: unknown = 14; own(x: number): string { calls++; return 'C14a.own' + x + this.v; } }
function call14a(o: C14a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run14a(o: C14a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call14a(o); hook(o, C14a.prototype, A14a.prototype); return s + '|' + call14a(o) + '|' + call14a(escape(new C14a())); }
class A15t { m(x: number): string { calls++; return 'A15t.m' + x; } }
class C15t extends A15t { v: unknown = 15; own(x: number): string { calls++; return 'C15t.own' + x + this.v; } }
function run15t(o: C15t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C15t.prototype, A15t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A15l { m(x: number): string { calls++; return 'A15l.m' + x; } }
class C15l extends A15l { v: unknown = 15; own(x: number): string { calls++; return 'C15l.own' + x + this.v; } }
function run15l(o: C15l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C15l.prototype, A15l.prototype); s += o.m(i) + ';'; } return s; }
class A15f { m(x: number): string { calls++; return 'A15f.m' + x; } }
class C15f extends A15f { v: unknown = 15; own(x: number): string { calls++; return 'C15f.own' + x + this.v; } }
function call15f(o: C15f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run15f(o: C15f, hook: Hook): string { hook(o, C15f.prototype, A15f.prototype); return call15f(o); }
class A15a { m(x: number): string { calls++; return 'A15a.m' + x; } }
class C15a extends A15a { v: unknown = 15; own(x: number): string { calls++; return 'C15a.own' + x + this.v; } }
function call15a(o: C15a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run15a(o: C15a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call15a(o); hook(o, C15a.prototype, A15a.prototype); return s + '|' + call15a(o) + '|' + call15a(escape(new C15a())); }
class A16t { m(x: number): string { calls++; return 'A16t.m' + x; } }
class C16t extends A16t { v: unknown = 16; own(x: number): string { calls++; return 'C16t.own' + x + this.v; } }
function run16t(o: C16t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C16t.prototype, A16t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A16l { m(x: number): string { calls++; return 'A16l.m' + x; } }
class C16l extends A16l { v: unknown = 16; own(x: number): string { calls++; return 'C16l.own' + x + this.v; } }
function run16l(o: C16l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C16l.prototype, A16l.prototype); s += o.m(i) + ';'; } return s; }
class A16f { m(x: number): string { calls++; return 'A16f.m' + x; } }
class C16f extends A16f { v: unknown = 16; own(x: number): string { calls++; return 'C16f.own' + x + this.v; } }
function call16f(o: C16f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run16f(o: C16f, hook: Hook): string { hook(o, C16f.prototype, A16f.prototype); return call16f(o); }
class A16a { m(x: number): string { calls++; return 'A16a.m' + x; } }
class C16a extends A16a { v: unknown = 16; own(x: number): string { calls++; return 'C16a.own' + x + this.v; } }
function call16a(o: C16a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run16a(o: C16a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call16a(o); hook(o, C16a.prototype, A16a.prototype); return s + '|' + call16a(o) + '|' + call16a(escape(new C16a())); }
class A17t { m(x: number): string { calls++; return 'A17t.m' + x; } }
class C17t extends A17t { v: unknown = 17; own(x: number): string { calls++; return 'C17t.own' + x + this.v; } }
function run17t(o: C17t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C17t.prototype, A17t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A17l { m(x: number): string { calls++; return 'A17l.m' + x; } }
class C17l extends A17l { v: unknown = 17; own(x: number): string { calls++; return 'C17l.own' + x + this.v; } }
function run17l(o: C17l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C17l.prototype, A17l.prototype); s += o.m(i) + ';'; } return s; }
class A17f { m(x: number): string { calls++; return 'A17f.m' + x; } }
class C17f extends A17f { v: unknown = 17; own(x: number): string { calls++; return 'C17f.own' + x + this.v; } }
function call17f(o: C17f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run17f(o: C17f, hook: Hook): string { hook(o, C17f.prototype, A17f.prototype); return call17f(o); }
class A17a { m(x: number): string { calls++; return 'A17a.m' + x; } }
class C17a extends A17a { v: unknown = 17; own(x: number): string { calls++; return 'C17a.own' + x + this.v; } }
function call17a(o: C17a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run17a(o: C17a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call17a(o); hook(o, C17a.prototype, A17a.prototype); return s + '|' + call17a(o) + '|' + call17a(escape(new C17a())); }
class A18t { m(x: number): string { calls++; return 'A18t.m' + x; } }
class C18t extends A18t { v: unknown = 18; own(x: number): string { calls++; return 'C18t.own' + x + this.v; } }
function run18t(o: C18t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C18t.prototype, A18t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A18l { m(x: number): string { calls++; return 'A18l.m' + x; } }
class C18l extends A18l { v: unknown = 18; own(x: number): string { calls++; return 'C18l.own' + x + this.v; } }
function run18l(o: C18l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C18l.prototype, A18l.prototype); s += o.m(i) + ';'; } return s; }
class A18f { m(x: number): string { calls++; return 'A18f.m' + x; } }
class C18f extends A18f { v: unknown = 18; own(x: number): string { calls++; return 'C18f.own' + x + this.v; } }
function call18f(o: C18f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run18f(o: C18f, hook: Hook): string { hook(o, C18f.prototype, A18f.prototype); return call18f(o); }
class A18a { m(x: number): string { calls++; return 'A18a.m' + x; } }
class C18a extends A18a { v: unknown = 18; own(x: number): string { calls++; return 'C18a.own' + x + this.v; } }
function call18a(o: C18a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run18a(o: C18a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call18a(o); hook(o, C18a.prototype, A18a.prototype); return s + '|' + call18a(o) + '|' + call18a(escape(new C18a())); }
class A19t { m(x: number): string { calls++; return 'A19t.m' + x; } }
class C19t extends A19t { v: unknown = 19; own(x: number): string { calls++; return 'C19t.own' + x + this.v; } }
function run19t(o: C19t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C19t.prototype, A19t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A19l { m(x: number): string { calls++; return 'A19l.m' + x; } }
class C19l extends A19l { v: unknown = 19; own(x: number): string { calls++; return 'C19l.own' + x + this.v; } }
function run19l(o: C19l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C19l.prototype, A19l.prototype); s += o.m(i) + ';'; } return s; }
class A19f { m(x: number): string { calls++; return 'A19f.m' + x; } }
class C19f extends A19f { v: unknown = 19; own(x: number): string { calls++; return 'C19f.own' + x + this.v; } }
function call19f(o: C19f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run19f(o: C19f, hook: Hook): string { hook(o, C19f.prototype, A19f.prototype); return call19f(o); }
class A19a { m(x: number): string { calls++; return 'A19a.m' + x; } }
class C19a extends A19a { v: unknown = 19; own(x: number): string { calls++; return 'C19a.own' + x + this.v; } }
function call19a(o: C19a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run19a(o: C19a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call19a(o); hook(o, C19a.prototype, A19a.prototype); return s + '|' + call19a(o) + '|' + call19a(escape(new C19a())); }
class A20t { m(x: number): string { calls++; return 'A20t.m' + x; } }
class C20t extends A20t { v: unknown = 20; own(x: number): string { calls++; return 'C20t.own' + x + this.v; } }
function run20t(o: C20t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C20t.prototype, A20t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A20l { m(x: number): string { calls++; return 'A20l.m' + x; } }
class C20l extends A20l { v: unknown = 20; own(x: number): string { calls++; return 'C20l.own' + x + this.v; } }
function run20l(o: C20l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C20l.prototype, A20l.prototype); s += o.m(i) + ';'; } return s; }
class A20f { m(x: number): string { calls++; return 'A20f.m' + x; } }
class C20f extends A20f { v: unknown = 20; own(x: number): string { calls++; return 'C20f.own' + x + this.v; } }
function call20f(o: C20f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run20f(o: C20f, hook: Hook): string { hook(o, C20f.prototype, A20f.prototype); return call20f(o); }
class A20a { m(x: number): string { calls++; return 'A20a.m' + x; } }
class C20a extends A20a { v: unknown = 20; own(x: number): string { calls++; return 'C20a.own' + x + this.v; } }
function call20a(o: C20a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run20a(o: C20a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call20a(o); hook(o, C20a.prototype, A20a.prototype); return s + '|' + call20a(o) + '|' + call20a(escape(new C20a())); }
class A21t { m(x: number): string { calls++; return 'A21t.m' + x; } }
class C21t extends A21t { v: unknown = 21; own(x: number): string { calls++; return 'C21t.own' + x + this.v; } }
function run21t(o: C21t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C21t.prototype, A21t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A21l { m(x: number): string { calls++; return 'A21l.m' + x; } }
class C21l extends A21l { v: unknown = 21; own(x: number): string { calls++; return 'C21l.own' + x + this.v; } }
function run21l(o: C21l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C21l.prototype, A21l.prototype); s += o.m(i) + ';'; } return s; }
class A21f { m(x: number): string { calls++; return 'A21f.m' + x; } }
class C21f extends A21f { v: unknown = 21; own(x: number): string { calls++; return 'C21f.own' + x + this.v; } }
function call21f(o: C21f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run21f(o: C21f, hook: Hook): string { hook(o, C21f.prototype, A21f.prototype); return call21f(o); }
class A21a { m(x: number): string { calls++; return 'A21a.m' + x; } }
class C21a extends A21a { v: unknown = 21; own(x: number): string { calls++; return 'C21a.own' + x + this.v; } }
function call21a(o: C21a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run21a(o: C21a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call21a(o); hook(o, C21a.prototype, A21a.prototype); return s + '|' + call21a(o) + '|' + call21a(escape(new C21a())); }
class A22t { m(x: number): string { calls++; return 'A22t.m' + x; } }
class C22t extends A22t { v: unknown = 22; own(x: number): string { calls++; return 'C22t.own' + x + this.v; } }
function run22t(o: C22t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C22t.prototype, A22t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A22l { m(x: number): string { calls++; return 'A22l.m' + x; } }
class C22l extends A22l { v: unknown = 22; own(x: number): string { calls++; return 'C22l.own' + x + this.v; } }
function run22l(o: C22l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C22l.prototype, A22l.prototype); s += o.m(i) + ';'; } return s; }
class A22f { m(x: number): string { calls++; return 'A22f.m' + x; } }
class C22f extends A22f { v: unknown = 22; own(x: number): string { calls++; return 'C22f.own' + x + this.v; } }
function call22f(o: C22f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run22f(o: C22f, hook: Hook): string { hook(o, C22f.prototype, A22f.prototype); return call22f(o); }
class A22a { m(x: number): string { calls++; return 'A22a.m' + x; } }
class C22a extends A22a { v: unknown = 22; own(x: number): string { calls++; return 'C22a.own' + x + this.v; } }
function call22a(o: C22a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run22a(o: C22a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call22a(o); hook(o, C22a.prototype, A22a.prototype); return s + '|' + call22a(o) + '|' + call22a(escape(new C22a())); }
class A23t { m(x: number): string { calls++; return 'A23t.m' + x; } }
class C23t extends A23t { v: unknown = 23; own(x: number): string { calls++; return 'C23t.own' + x + this.v; } }
function run23t(o: C23t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C23t.prototype, A23t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A23l { m(x: number): string { calls++; return 'A23l.m' + x; } }
class C23l extends A23l { v: unknown = 23; own(x: number): string { calls++; return 'C23l.own' + x + this.v; } }
function run23l(o: C23l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C23l.prototype, A23l.prototype); s += o.m(i) + ';'; } return s; }
class A23f { m(x: number): string { calls++; return 'A23f.m' + x; } }
class C23f extends A23f { v: unknown = 23; own(x: number): string { calls++; return 'C23f.own' + x + this.v; } }
function call23f(o: C23f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run23f(o: C23f, hook: Hook): string { hook(o, C23f.prototype, A23f.prototype); return call23f(o); }
class A23a { m(x: number): string { calls++; return 'A23a.m' + x; } }
class C23a extends A23a { v: unknown = 23; own(x: number): string { calls++; return 'C23a.own' + x + this.v; } }
function call23a(o: C23a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run23a(o: C23a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call23a(o); hook(o, C23a.prototype, A23a.prototype); return s + '|' + call23a(o) + '|' + call23a(escape(new C23a())); }
class A24t { m(x: number): string { calls++; return 'A24t.m' + x; } }
class C24t extends A24t { v: unknown = 24; own(x: number): string { calls++; return 'C24t.own' + x + this.v; } }
function run24t(o: C24t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C24t.prototype, A24t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A24l { m(x: number): string { calls++; return 'A24l.m' + x; } }
class C24l extends A24l { v: unknown = 24; own(x: number): string { calls++; return 'C24l.own' + x + this.v; } }
function run24l(o: C24l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C24l.prototype, A24l.prototype); s += o.m(i) + ';'; } return s; }
class A24f { m(x: number): string { calls++; return 'A24f.m' + x; } }
class C24f extends A24f { v: unknown = 24; own(x: number): string { calls++; return 'C24f.own' + x + this.v; } }
function call24f(o: C24f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run24f(o: C24f, hook: Hook): string { hook(o, C24f.prototype, A24f.prototype); return call24f(o); }
class A24a { m(x: number): string { calls++; return 'A24a.m' + x; } }
class C24a extends A24a { v: unknown = 24; own(x: number): string { calls++; return 'C24a.own' + x + this.v; } }
function call24a(o: C24a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run24a(o: C24a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call24a(o); hook(o, C24a.prototype, A24a.prototype); return s + '|' + call24a(o) + '|' + call24a(escape(new C24a())); }
class A25t { m(x: number): string { calls++; return 'A25t.m' + x; } }
class C25t extends A25t { v: unknown = 25; own(x: number): string { calls++; return 'C25t.own' + x + this.v; } }
function run25t(o: C25t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C25t.prototype, A25t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A25l { m(x: number): string { calls++; return 'A25l.m' + x; } }
class C25l extends A25l { v: unknown = 25; own(x: number): string { calls++; return 'C25l.own' + x + this.v; } }
function run25l(o: C25l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C25l.prototype, A25l.prototype); s += o.m(i) + ';'; } return s; }
class A25f { m(x: number): string { calls++; return 'A25f.m' + x; } }
class C25f extends A25f { v: unknown = 25; own(x: number): string { calls++; return 'C25f.own' + x + this.v; } }
function call25f(o: C25f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run25f(o: C25f, hook: Hook): string { hook(o, C25f.prototype, A25f.prototype); return call25f(o); }
class A25a { m(x: number): string { calls++; return 'A25a.m' + x; } }
class C25a extends A25a { v: unknown = 25; own(x: number): string { calls++; return 'C25a.own' + x + this.v; } }
function call25a(o: C25a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run25a(o: C25a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call25a(o); hook(o, C25a.prototype, A25a.prototype); return s + '|' + call25a(o) + '|' + call25a(escape(new C25a())); }
class A26t { m(x: number): string { calls++; return 'A26t.m' + x; } }
class C26t extends A26t { v: unknown = 26; own(x: number): string { calls++; return 'C26t.own' + x + this.v; } }
function run26t(o: C26t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C26t.prototype, A26t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A26l { m(x: number): string { calls++; return 'A26l.m' + x; } }
class C26l extends A26l { v: unknown = 26; own(x: number): string { calls++; return 'C26l.own' + x + this.v; } }
function run26l(o: C26l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C26l.prototype, A26l.prototype); s += o.m(i) + ';'; } return s; }
class A26f { m(x: number): string { calls++; return 'A26f.m' + x; } }
class C26f extends A26f { v: unknown = 26; own(x: number): string { calls++; return 'C26f.own' + x + this.v; } }
function call26f(o: C26f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run26f(o: C26f, hook: Hook): string { hook(o, C26f.prototype, A26f.prototype); return call26f(o); }
class A26a { m(x: number): string { calls++; return 'A26a.m' + x; } }
class C26a extends A26a { v: unknown = 26; own(x: number): string { calls++; return 'C26a.own' + x + this.v; } }
function call26a(o: C26a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run26a(o: C26a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call26a(o); hook(o, C26a.prototype, A26a.prototype); return s + '|' + call26a(o) + '|' + call26a(escape(new C26a())); }
class A27t { m(x: number): string { calls++; return 'A27t.m' + x; } }
class C27t extends A27t { v: unknown = 27; own(x: number): string { calls++; return 'C27t.own' + x + this.v; } }
function run27t(o: C27t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C27t.prototype, A27t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A27l { m(x: number): string { calls++; return 'A27l.m' + x; } }
class C27l extends A27l { v: unknown = 27; own(x: number): string { calls++; return 'C27l.own' + x + this.v; } }
function run27l(o: C27l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C27l.prototype, A27l.prototype); s += o.m(i) + ';'; } return s; }
class A27f { m(x: number): string { calls++; return 'A27f.m' + x; } }
class C27f extends A27f { v: unknown = 27; own(x: number): string { calls++; return 'C27f.own' + x + this.v; } }
function call27f(o: C27f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run27f(o: C27f, hook: Hook): string { hook(o, C27f.prototype, A27f.prototype); return call27f(o); }
class A27a { m(x: number): string { calls++; return 'A27a.m' + x; } }
class C27a extends A27a { v: unknown = 27; own(x: number): string { calls++; return 'C27a.own' + x + this.v; } }
function call27a(o: C27a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run27a(o: C27a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call27a(o); hook(o, C27a.prototype, A27a.prototype); return s + '|' + call27a(o) + '|' + call27a(escape(new C27a())); }
class A28t { m(x: number): string { calls++; return 'A28t.m' + x; } }
class C28t extends A28t { v: unknown = 28; own(x: number): string { calls++; return 'C28t.own' + x + this.v; } }
function run28t(o: C28t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C28t.prototype, A28t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A28l { m(x: number): string { calls++; return 'A28l.m' + x; } }
class C28l extends A28l { v: unknown = 28; own(x: number): string { calls++; return 'C28l.own' + x + this.v; } }
function run28l(o: C28l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C28l.prototype, A28l.prototype); s += o.m(i) + ';'; } return s; }
class A28f { m(x: number): string { calls++; return 'A28f.m' + x; } }
class C28f extends A28f { v: unknown = 28; own(x: number): string { calls++; return 'C28f.own' + x + this.v; } }
function call28f(o: C28f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run28f(o: C28f, hook: Hook): string { hook(o, C28f.prototype, A28f.prototype); return call28f(o); }
class A28a { m(x: number): string { calls++; return 'A28a.m' + x; } }
class C28a extends A28a { v: unknown = 28; own(x: number): string { calls++; return 'C28a.own' + x + this.v; } }
function call28a(o: C28a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run28a(o: C28a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call28a(o); hook(o, C28a.prototype, A28a.prototype); return s + '|' + call28a(o) + '|' + call28a(escape(new C28a())); }
class A29t { m(x: number): string { calls++; return 'A29t.m' + x; } }
class C29t extends A29t { v: unknown = 29; own(x: number): string { calls++; return 'C29t.own' + x + this.v; } }
function run29t(o: C29t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C29t.prototype, A29t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A29l { m(x: number): string { calls++; return 'A29l.m' + x; } }
class C29l extends A29l { v: unknown = 29; own(x: number): string { calls++; return 'C29l.own' + x + this.v; } }
function run29l(o: C29l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C29l.prototype, A29l.prototype); s += o.m(i) + ';'; } return s; }
class A29f { m(x: number): string { calls++; return 'A29f.m' + x; } }
class C29f extends A29f { v: unknown = 29; own(x: number): string { calls++; return 'C29f.own' + x + this.v; } }
function call29f(o: C29f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run29f(o: C29f, hook: Hook): string { hook(o, C29f.prototype, A29f.prototype); return call29f(o); }
class A29a { m(x: number): string { calls++; return 'A29a.m' + x; } }
class C29a extends A29a { v: unknown = 29; own(x: number): string { calls++; return 'C29a.own' + x + this.v; } }
function call29a(o: C29a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run29a(o: C29a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call29a(o); hook(o, C29a.prototype, A29a.prototype); return s + '|' + call29a(o) + '|' + call29a(escape(new C29a())); }
class A30t { m(x: number): string { calls++; return 'A30t.m' + x; } }
class C30t extends A30t { v: unknown = 30; own(x: number): string { calls++; return 'C30t.own' + x + this.v; } }
function run30t(o: C30t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C30t.prototype, A30t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A30l { m(x: number): string { calls++; return 'A30l.m' + x; } }
class C30l extends A30l { v: unknown = 30; own(x: number): string { calls++; return 'C30l.own' + x + this.v; } }
function run30l(o: C30l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C30l.prototype, A30l.prototype); s += o.m(i) + ';'; } return s; }
class A30f { m(x: number): string { calls++; return 'A30f.m' + x; } }
class C30f extends A30f { v: unknown = 30; own(x: number): string { calls++; return 'C30f.own' + x + this.v; } }
function call30f(o: C30f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run30f(o: C30f, hook: Hook): string { hook(o, C30f.prototype, A30f.prototype); return call30f(o); }
class A30a { m(x: number): string { calls++; return 'A30a.m' + x; } }
class C30a extends A30a { v: unknown = 30; own(x: number): string { calls++; return 'C30a.own' + x + this.v; } }
function call30a(o: C30a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run30a(o: C30a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call30a(o); hook(o, C30a.prototype, A30a.prototype); return s + '|' + call30a(o) + '|' + call30a(escape(new C30a())); }
class A31t { m(x: number): string { calls++; return 'A31t.m' + x; } }
class C31t extends A31t { v: unknown = 31; own(x: number): string { calls++; return 'C31t.own' + x + this.v; } }
function run31t(o: C31t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C31t.prototype, A31t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A31l { m(x: number): string { calls++; return 'A31l.m' + x; } }
class C31l extends A31l { v: unknown = 31; own(x: number): string { calls++; return 'C31l.own' + x + this.v; } }
function run31l(o: C31l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C31l.prototype, A31l.prototype); s += o.m(i) + ';'; } return s; }
class A31f { m(x: number): string { calls++; return 'A31f.m' + x; } }
class C31f extends A31f { v: unknown = 31; own(x: number): string { calls++; return 'C31f.own' + x + this.v; } }
function call31f(o: C31f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run31f(o: C31f, hook: Hook): string { hook(o, C31f.prototype, A31f.prototype); return call31f(o); }
class A31a { m(x: number): string { calls++; return 'A31a.m' + x; } }
class C31a extends A31a { v: unknown = 31; own(x: number): string { calls++; return 'C31a.own' + x + this.v; } }
function call31a(o: C31a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run31a(o: C31a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call31a(o); hook(o, C31a.prototype, A31a.prototype); return s + '|' + call31a(o) + '|' + call31a(escape(new C31a())); }
class A32t { m(x: number): string { calls++; return 'A32t.m' + x; } }
class C32t extends A32t { v: unknown = 32; own(x: number): string { calls++; return 'C32t.own' + x + this.v; } }
function run32t(o: C32t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C32t.prototype, A32t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A32l { m(x: number): string { calls++; return 'A32l.m' + x; } }
class C32l extends A32l { v: unknown = 32; own(x: number): string { calls++; return 'C32l.own' + x + this.v; } }
function run32l(o: C32l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C32l.prototype, A32l.prototype); s += o.m(i) + ';'; } return s; }
class A32f { m(x: number): string { calls++; return 'A32f.m' + x; } }
class C32f extends A32f { v: unknown = 32; own(x: number): string { calls++; return 'C32f.own' + x + this.v; } }
function call32f(o: C32f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run32f(o: C32f, hook: Hook): string { hook(o, C32f.prototype, A32f.prototype); return call32f(o); }
class A32a { m(x: number): string { calls++; return 'A32a.m' + x; } }
class C32a extends A32a { v: unknown = 32; own(x: number): string { calls++; return 'C32a.own' + x + this.v; } }
function call32a(o: C32a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run32a(o: C32a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call32a(o); hook(o, C32a.prototype, A32a.prototype); return s + '|' + call32a(o) + '|' + call32a(escape(new C32a())); }
class A33t { m(x: number): string { calls++; return 'A33t.m' + x; } }
class C33t extends A33t { v: unknown = 33; own(x: number): string { calls++; return 'C33t.own' + x + this.v; } }
function run33t(o: C33t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C33t.prototype, A33t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A33l { m(x: number): string { calls++; return 'A33l.m' + x; } }
class C33l extends A33l { v: unknown = 33; own(x: number): string { calls++; return 'C33l.own' + x + this.v; } }
function run33l(o: C33l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C33l.prototype, A33l.prototype); s += o.m(i) + ';'; } return s; }
class A33f { m(x: number): string { calls++; return 'A33f.m' + x; } }
class C33f extends A33f { v: unknown = 33; own(x: number): string { calls++; return 'C33f.own' + x + this.v; } }
function call33f(o: C33f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run33f(o: C33f, hook: Hook): string { hook(o, C33f.prototype, A33f.prototype); return call33f(o); }
class A33a { m(x: number): string { calls++; return 'A33a.m' + x; } }
class C33a extends A33a { v: unknown = 33; own(x: number): string { calls++; return 'C33a.own' + x + this.v; } }
function call33a(o: C33a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run33a(o: C33a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call33a(o); hook(o, C33a.prototype, A33a.prototype); return s + '|' + call33a(o) + '|' + call33a(escape(new C33a())); }
class A34t { m(x: number): string { calls++; return 'A34t.m' + x; } }
class C34t extends A34t { v: unknown = 34; own(x: number): string { calls++; return 'C34t.own' + x + this.v; } }
function run34t(o: C34t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C34t.prototype, A34t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A34l { m(x: number): string { calls++; return 'A34l.m' + x; } }
class C34l extends A34l { v: unknown = 34; own(x: number): string { calls++; return 'C34l.own' + x + this.v; } }
function run34l(o: C34l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C34l.prototype, A34l.prototype); s += o.m(i) + ';'; } return s; }
class A34f { m(x: number): string { calls++; return 'A34f.m' + x; } }
class C34f extends A34f { v: unknown = 34; own(x: number): string { calls++; return 'C34f.own' + x + this.v; } }
function call34f(o: C34f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run34f(o: C34f, hook: Hook): string { hook(o, C34f.prototype, A34f.prototype); return call34f(o); }
class A34a { m(x: number): string { calls++; return 'A34a.m' + x; } }
class C34a extends A34a { v: unknown = 34; own(x: number): string { calls++; return 'C34a.own' + x + this.v; } }
function call34a(o: C34a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run34a(o: C34a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call34a(o); hook(o, C34a.prototype, A34a.prototype); return s + '|' + call34a(o) + '|' + call34a(escape(new C34a())); }
class A35t { m(x: number): string { calls++; return 'A35t.m' + x; } }
class C35t extends A35t { v: unknown = 35; own(x: number): string { calls++; return 'C35t.own' + x + this.v; } }
function run35t(o: C35t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C35t.prototype, A35t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A35l { m(x: number): string { calls++; return 'A35l.m' + x; } }
class C35l extends A35l { v: unknown = 35; own(x: number): string { calls++; return 'C35l.own' + x + this.v; } }
function run35l(o: C35l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C35l.prototype, A35l.prototype); s += o.m(i) + ';'; } return s; }
class A35f { m(x: number): string { calls++; return 'A35f.m' + x; } }
class C35f extends A35f { v: unknown = 35; own(x: number): string { calls++; return 'C35f.own' + x + this.v; } }
function call35f(o: C35f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run35f(o: C35f, hook: Hook): string { hook(o, C35f.prototype, A35f.prototype); return call35f(o); }
class A35a { m(x: number): string { calls++; return 'A35a.m' + x; } }
class C35a extends A35a { v: unknown = 35; own(x: number): string { calls++; return 'C35a.own' + x + this.v; } }
function call35a(o: C35a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run35a(o: C35a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call35a(o); hook(o, C35a.prototype, A35a.prototype); return s + '|' + call35a(o) + '|' + call35a(escape(new C35a())); }
class A36t { m(x: number): string { calls++; return 'A36t.m' + x; } }
class C36t extends A36t { v: unknown = 36; own(x: number): string { calls++; return 'C36t.own' + x + this.v; } }
function run36t(o: C36t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C36t.prototype, A36t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A36l { m(x: number): string { calls++; return 'A36l.m' + x; } }
class C36l extends A36l { v: unknown = 36; own(x: number): string { calls++; return 'C36l.own' + x + this.v; } }
function run36l(o: C36l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C36l.prototype, A36l.prototype); s += o.m(i) + ';'; } return s; }
class A36f { m(x: number): string { calls++; return 'A36f.m' + x; } }
class C36f extends A36f { v: unknown = 36; own(x: number): string { calls++; return 'C36f.own' + x + this.v; } }
function call36f(o: C36f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run36f(o: C36f, hook: Hook): string { hook(o, C36f.prototype, A36f.prototype); return call36f(o); }
class A36a { m(x: number): string { calls++; return 'A36a.m' + x; } }
class C36a extends A36a { v: unknown = 36; own(x: number): string { calls++; return 'C36a.own' + x + this.v; } }
function call36a(o: C36a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run36a(o: C36a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call36a(o); hook(o, C36a.prototype, A36a.prototype); return s + '|' + call36a(o) + '|' + call36a(escape(new C36a())); }
class A37t { m(x: number): string { calls++; return 'A37t.m' + x; } }
class C37t extends A37t { v: unknown = 37; own(x: number): string { calls++; return 'C37t.own' + x + this.v; } }
function run37t(o: C37t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C37t.prototype, A37t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A37l { m(x: number): string { calls++; return 'A37l.m' + x; } }
class C37l extends A37l { v: unknown = 37; own(x: number): string { calls++; return 'C37l.own' + x + this.v; } }
function run37l(o: C37l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C37l.prototype, A37l.prototype); s += o.m(i) + ';'; } return s; }
class A37f { m(x: number): string { calls++; return 'A37f.m' + x; } }
class C37f extends A37f { v: unknown = 37; own(x: number): string { calls++; return 'C37f.own' + x + this.v; } }
function call37f(o: C37f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run37f(o: C37f, hook: Hook): string { hook(o, C37f.prototype, A37f.prototype); return call37f(o); }
class A37a { m(x: number): string { calls++; return 'A37a.m' + x; } }
class C37a extends A37a { v: unknown = 37; own(x: number): string { calls++; return 'C37a.own' + x + this.v; } }
function call37a(o: C37a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run37a(o: C37a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call37a(o); hook(o, C37a.prototype, A37a.prototype); return s + '|' + call37a(o) + '|' + call37a(escape(new C37a())); }
class A38t { m(x: number): string { calls++; return 'A38t.m' + x; } }
class C38t extends A38t { v: unknown = 38; own(x: number): string { calls++; return 'C38t.own' + x + this.v; } }
function run38t(o: C38t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C38t.prototype, A38t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A38l { m(x: number): string { calls++; return 'A38l.m' + x; } }
class C38l extends A38l { v: unknown = 38; own(x: number): string { calls++; return 'C38l.own' + x + this.v; } }
function run38l(o: C38l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C38l.prototype, A38l.prototype); s += o.m(i) + ';'; } return s; }
class A38f { m(x: number): string { calls++; return 'A38f.m' + x; } }
class C38f extends A38f { v: unknown = 38; own(x: number): string { calls++; return 'C38f.own' + x + this.v; } }
function call38f(o: C38f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run38f(o: C38f, hook: Hook): string { hook(o, C38f.prototype, A38f.prototype); return call38f(o); }
class A38a { m(x: number): string { calls++; return 'A38a.m' + x; } }
class C38a extends A38a { v: unknown = 38; own(x: number): string { calls++; return 'C38a.own' + x + this.v; } }
function call38a(o: C38a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run38a(o: C38a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call38a(o); hook(o, C38a.prototype, A38a.prototype); return s + '|' + call38a(o) + '|' + call38a(escape(new C38a())); }
class A39t { m(x: number): string { calls++; return 'A39t.m' + x; } }
class C39t extends A39t { v: unknown = 39; own(x: number): string { calls++; return 'C39t.own' + x + this.v; } }
function run39t(o: C39t, hook: Hook): string { let s = ''; for (let r = 0; r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C39t.prototype, A39t.prototype); s += '|' + o.own(r + 2) + o.m(r + 2) + ';'; } return s; }
class A39l { m(x: number): string { calls++; return 'A39l.m' + x; } }
class C39l extends A39l { v: unknown = 39; own(x: number): string { calls++; return 'C39l.own' + x + this.v; } }
function run39l(o: C39l, hook: Hook): string { let s = ''; for (let i = 0; i < 4; i++) { s += o.own(i); if (i === 1) hook(o, C39l.prototype, A39l.prototype); s += o.m(i) + ';'; } return s; }
class A39f { m(x: number): string { calls++; return 'A39f.m' + x; } }
class C39f extends A39f { v: unknown = 39; own(x: number): string { calls++; return 'C39f.own' + x + this.v; } }
function call39f(o: C39f): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run39f(o: C39f, hook: Hook): string { hook(o, C39f.prototype, A39f.prototype); return call39f(o); }
class A39a { m(x: number): string { calls++; return 'A39a.m' + x; } }
class C39a extends A39a { v: unknown = 39; own(x: number): string { calls++; return 'C39a.own' + x + this.v; } }
function call39a(o: C39a): string { let s = ''; for (let i = 0; i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run39a(o: C39a, hook: Hook): string { let s = ''; for (let i = 0; i < 3; i++) s += call39a(o); hook(o, C39a.prototype, A39a.prototype); return s + '|' + call39a(o) + '|' + call39a(escape(new C39a())); }
console.log('nothing', attempt(() => run0t(escape(new C0t()), hooks[0])), attempt(() => run0l(escape(new C0l()), hooks[0])), attempt(() => run0f(escape(new C0f()), hooks[0])), attempt(() => run0a(escape(new C0a()), hooks[0])));
console.log('own class: assigned', attempt(() => run1t(escape(new C1t()), hooks[1])), attempt(() => run1l(escape(new C1l()), hooks[1])), attempt(() => run1f(escape(new C1f()), hooks[1])), attempt(() => run1a(escape(new C1a()), hooks[1])));
console.log('class above: assigned', attempt(() => run2t(escape(new C2t()), hooks[2])), attempt(() => run2l(escape(new C2l()), hooks[2])), attempt(() => run2f(escape(new C2f()), hooks[2])), attempt(() => run2a(escape(new C2a()), hooks[2])));
console.log('own class: added over the one above', attempt(() => run3t(escape(new C3t()), hooks[3])), attempt(() => run3l(escape(new C3l()), hooks[3])), attempt(() => run3f(escape(new C3f()), hooks[3])), attempt(() => run3a(escape(new C3a()), hooks[3])));
console.log('own class: a getter', attempt(() => run4t(escape(new C4t()), hooks[4])), attempt(() => run4l(escape(new C4l()), hooks[4])), attempt(() => run4f(escape(new C4f()), hooks[4])), attempt(() => run4a(escape(new C4a()), hooks[4])));
console.log('class above: a getter', attempt(() => run5t(escape(new C5t()), hooks[5])), attempt(() => run5l(escape(new C5l()), hooks[5])), attempt(() => run5f(escape(new C5f()), hooks[5])), attempt(() => run5a(escape(new C5a()), hooks[5])));
console.log('own class: a getter over the one above', attempt(() => run6t(escape(new C6t()), hooks[6])), attempt(() => run6l(escape(new C6l()), hooks[6])), attempt(() => run6f(escape(new C6f()), hooks[6])), attempt(() => run6a(escape(new C6a()), hooks[6])));
console.log('own class: deleted', attempt(() => run7t(escape(new C7t()), hooks[7])), attempt(() => run7l(escape(new C7l()), hooks[7])), attempt(() => run7f(escape(new C7f()), hooks[7])), attempt(() => run7a(escape(new C7a()), hooks[7])));
console.log('class above: deleted', attempt(() => run8t(escape(new C8t()), hooks[8])), attempt(() => run8l(escape(new C8l()), hooks[8])), attempt(() => run8f(escape(new C8f()), hooks[8])), attempt(() => run8a(escape(new C8a()), hooks[8])));
console.log('instance: assigned', attempt(() => run9t(escape(new C9t()), hooks[9])), attempt(() => run9l(escape(new C9l()), hooks[9])), attempt(() => run9f(escape(new C9f()), hooks[9])), attempt(() => run9a(escape(new C9a()), hooks[9])));
console.log('instance: assigned over the one above', attempt(() => run10t(escape(new C10t()), hooks[10])), attempt(() => run10l(escape(new C10l()), hooks[10])), attempt(() => run10f(escape(new C10f()), hooks[10])), attempt(() => run10a(escape(new C10a()), hooks[10])));
console.log('instance: defined', attempt(() => run11t(escape(new C11t()), hooks[11])), attempt(() => run11l(escape(new C11l()), hooks[11])), attempt(() => run11f(escape(new C11f()), hooks[11])), attempt(() => run11a(escape(new C11a()), hooks[11])));
console.log('instance: a getter', attempt(() => run12t(escape(new C12t()), hooks[12])), attempt(() => run12l(escape(new C12l()), hooks[12])), attempt(() => run12f(escape(new C12f()), hooks[12])), attempt(() => run12a(escape(new C12a()), hooks[12])));
console.log('instance: copied onto', attempt(() => run13t(escape(new C13t()), hooks[13])), attempt(() => run13l(escape(new C13l()), hooks[13])), attempt(() => run13f(escape(new C13f()), hooks[13])), attempt(() => run13a(escape(new C13a()), hooks[13])));
console.log('instance: under a computed key', attempt(() => run14t(escape(new C14t()), hooks[14])), attempt(() => run14l(escape(new C14l()), hooks[14])), attempt(() => run14f(escape(new C14f()), hooks[14])), attempt(() => run14a(escape(new C14a()), hooks[14])));
console.log('own class: under a computed key', attempt(() => run15t(escape(new C15t()), hooks[15])), attempt(() => run15l(escape(new C15l()), hooks[15])), attempt(() => run15f(escape(new C15f()), hooks[15])), attempt(() => run15a(escape(new C15a()), hooks[15])));
console.log('class above: under a computed key', attempt(() => run16t(escape(new C16t()), hooks[16])), attempt(() => run16l(escape(new C16l()), hooks[16])), attempt(() => run16f(escape(new C16f()), hooks[16])), attempt(() => run16a(escape(new C16a()), hooks[16])));
console.log('instance: another prototype', attempt(() => run17t(escape(new C17t()), hooks[17])), attempt(() => run17l(escape(new C17l()), hooks[17])), attempt(() => run17f(escape(new C17f()), hooks[17])), attempt(() => run17a(escape(new C17a()), hooks[17])));
console.log('instance: no prototype', attempt(() => run18t(escape(new C18t()), hooks[18])), attempt(() => run18l(escape(new C18l()), hooks[18])), attempt(() => run18f(escape(new C18f()), hooks[18])), attempt(() => run18a(escape(new C18a()), hooks[18])));
console.log('instance: an object below its class', attempt(() => run19t(escape(new C19t()), hooks[19])), attempt(() => run19l(escape(new C19l()), hooks[19])), attempt(() => run19f(escape(new C19f()), hooks[19])), attempt(() => run19a(escape(new C19a()), hooks[19])));
console.log('instance: an object below its class that hides', attempt(() => run20t(escape(new C20t()), hooks[20])), attempt(() => run20l(escape(new C20l()), hooks[20])), attempt(() => run20f(escape(new C20f()), hooks[20])), attempt(() => run20a(escape(new C20a()), hooks[20])));
console.log('instance: the class above', attempt(() => run21t(escape(new C21t()), hooks[21])), attempt(() => run21l(escape(new C21l()), hooks[21])), attempt(() => run21f(escape(new C21f()), hooks[21])), attempt(() => run21a(escape(new C21a()), hooks[21])));
console.log('instance: __proto__', attempt(() => run22t(escape(new C22t()), hooks[22])), attempt(() => run22l(escape(new C22l()), hooks[22])), attempt(() => run22f(escape(new C22f()), hooks[22])), attempt(() => run22a(escape(new C22a()), hooks[22])));
console.log('own class: another parent', attempt(() => run23t(escape(new C23t()), hooks[23])), attempt(() => run23l(escape(new C23l()), hooks[23])), attempt(() => run23f(escape(new C23f()), hooks[23])), attempt(() => run23a(escape(new C23a()), hooks[23])));
console.log('own class: no parent', attempt(() => run24t(escape(new C24t()), hooks[24])), attempt(() => run24l(escape(new C24l()), hooks[24])), attempt(() => run24f(escape(new C24f()), hooks[24])), attempt(() => run24a(escape(new C24a()), hooks[24])));
console.log('own class: __proto__', attempt(() => run25t(escape(new C25t()), hooks[25])), attempt(() => run25l(escape(new C25l()), hooks[25])), attempt(() => run25f(escape(new C25f()), hooks[25])), attempt(() => run25a(escape(new C25a()), hooks[25])));
console.log('class above: another parent', attempt(() => run26t(escape(new C26t()), hooks[26])), attempt(() => run26l(escape(new C26l()), hooks[26])), attempt(() => run26f(escape(new C26f()), hooks[26])), attempt(() => run26a(escape(new C26a()), hooks[26])));
console.log('own class: Reflect.set', attempt(() => run27t(escape(new C27t()), hooks[27])), attempt(() => run27l(escape(new C27l()), hooks[27])), attempt(() => run27f(escape(new C27f()), hooks[27])), attempt(() => run27a(escape(new C27a()), hooks[27])));
console.log('class above: Reflect.defineProperty', attempt(() => run28t(escape(new C28t()), hooks[28])), attempt(() => run28l(escape(new C28l()), hooks[28])), attempt(() => run28f(escape(new C28f()), hooks[28])), attempt(() => run28a(escape(new C28a()), hooks[28])));
console.log('own class: the same again', attempt(() => run29t(escape(new C29t()), hooks[29])), attempt(() => run29l(escape(new C29l()), hooks[29])), attempt(() => run29f(escape(new C29f()), hooks[29])), attempt(() => run29a(escape(new C29a()), hooks[29])));
console.log('own class: frozen', attempt(() => run30t(escape(new C30t()), hooks[30])), attempt(() => run30l(escape(new C30l()), hooks[30])), attempt(() => run30f(escape(new C30f()), hooks[30])), attempt(() => run30a(escape(new C30a()), hooks[30])));
console.log('own class: no function', attempt(() => run31t(escape(new C31t()), hooks[31])), attempt(() => run31l(escape(new C31l()), hooks[31])), attempt(() => run31f(escape(new C31f()), hooks[31])), attempt(() => run31a(escape(new C31a()), hooks[31])));
console.log('class above: undefined', attempt(() => run32t(escape(new C32t()), hooks[32])), attempt(() => run32l(escape(new C32l()), hooks[32])), attempt(() => run32f(escape(new C32f()), hooks[32])), attempt(() => run32a(escape(new C32a()), hooks[32])));
console.log('own class: read only', attempt(() => run33t(escape(new C33t()), hooks[33])), attempt(() => run33l(escape(new C33l()), hooks[33])), attempt(() => run33f(escape(new C33f()), hooks[33])), attempt(() => run33a(escape(new C33a()), hooks[33])));
console.log('another instance: assigned', attempt(() => run34t(escape(new C34t()), hooks[34])), attempt(() => run34l(escape(new C34l()), hooks[34])), attempt(() => run34f(escape(new C34f()), hooks[34])), attempt(() => run34a(escape(new C34a()), hooks[34])));
console.log('instance: assigned and deleted', attempt(() => run35t(escape(new C35t()), hooks[35])), attempt(() => run35l(escape(new C35l()), hooks[35])), attempt(() => run35f(escape(new C35f()), hooks[35])), attempt(() => run35a(escape(new C35a()), hooks[35])));
console.log('own class: assigned and put back', attempt(() => run36t(escape(new C36t()), hooks[36])), attempt(() => run36l(escape(new C36l()), hooks[36])), attempt(() => run36f(escape(new C36f()), hooks[36])), attempt(() => run36a(escape(new C36a()), hooks[36])));
console.log('own class: a bound function of the same', attempt(() => run37t(escape(new C37t()), hooks[37])), attempt(() => run37l(escape(new C37l()), hooks[37])), attempt(() => run37f(escape(new C37f()), hooks[37])), attempt(() => run37a(escape(new C37a()), hooks[37])));
console.log('instance: frozen', attempt(() => run38t(escape(new C38t()), hooks[38])), attempt(() => run38l(escape(new C38l()), hooks[38])), attempt(() => run38f(escape(new C38f()), hooks[38])), attempt(() => run38a(escape(new C38a()), hooks[38])));
console.log('instance: other properties', attempt(() => run39t(escape(new C39t()), hooks[39])), attempt(() => run39l(escape(new C39l()), hooks[39])), attempt(() => run39f(escape(new C39f()), hooks[39])), attempt(() => run39a(escape(new C39a()), hooks[39])));
