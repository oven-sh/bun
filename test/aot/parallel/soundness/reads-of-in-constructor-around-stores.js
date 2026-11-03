// A read of the object under construction is assumed to start at the prototype until a store under the name may have reached the object.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
// 1: nothing stored yet: the prototype's
{ class C { constructor() { this.seen = this.m; this.m = 1; } } C.prototype.m = "proto"; const o = new C(); show("1", o.seen.length, o.m + 1); }
// 2: stored by the base constructor
{ class B { constructor() { this.m = 1; } } class C extends B { constructor() { super(); this.seen = this.m; } } C.prototype.m = "proto"; show("2", new C().seen + 1); }
// 3: defined by a field initializer
{ class C { m = 1; constructor() { this.seen = this.m; } } C.prototype.m = "proto"; show("3", new C().seen + 1); }
// 4: stored by a method that the constructor calls
{ class C { constructor() { this.init(); this.seen = this.m; } init() { this.m = 1; } } C.prototype.m = "proto"; show("4", new C().seen + 1); }
// 5: stored by a method that a subclass overrides
{ class C { constructor() { this.init(); this.seen = this.m; } init() {} } class D extends C { init() { this.m = 1; } } C.prototype.m = "proto"; show("5", new C().seen.length, new D().seen + 1); }
// 6: Object.assign and a key nobody can name
{ class C { constructor(options) { Object.assign(this, options); this.seen = this.m; } } C.prototype.m = "proto"; show("6a", new C({ m: 1 }).seen + 1, new C({}).seen.length);
  class D { constructor(k) { this[k] = 1; this.seen = this.m; } } D.prototype.m = "proto"; show("6b", new D(dynamic("m")).seen + 1, new D(dynamic("z")).seen.length); }
// 7: Object.defineProperty
{ class C { constructor() { Object.defineProperty(this, "m", { value: 1 }); this.seen = this.m; } } C.prototype.m = "proto"; show("7", new C().seen + 1); }
// 8: through another name for this
{ class C { constructor() { const self = this; self.m = 1; this.seen = this.m; } } C.prototype.m = "proto"; show("8", new C().seen + 1); }
// 9: in a loop, the store comes after the read in the text
{ class C { constructor() { this.seen = []; for (let i = 0; i < 2; i++) { this.seen.push(typeof this.m); this.m = 1; } } } C.prototype.m = "proto"; show("9", new C().seen.join()); }
// 10: a closure over this stores, and runs before the read
{ class C { constructor() { const put = () => { this.m = 1; }; put(); this.seen = this.m; } } C.prototype.m = "proto"; show("10", new C().seen + 1); }
// 11: a setter of the class stores under another name
{ class C { constructor() { this.both = 1; this.seen = this.m; } set both(v) { this.m = v; } } C.prototype.m = "proto"; show("11", new C().seen + 1); }
// 12: on one path only
{ class C { constructor(f) { if (f) this.m = 1; this.seen = this.m; } } C.prototype.m = "proto"; show("12", new C(true).seen + 1, new C(false).seen.length); }
// 13: a function that is passed this
{ function fill(o) { o.m = 1; } class C { constructor() { fill(this); this.seen = this.m; } } C.prototype.m = "proto"; show("13", new C().seen + 1); }
// 14: a constructor function, with new and on an object that exists
{ function F() { this.seen = this.m; this.m = 2; } F.prototype.m = "proto"; const a = new F(); const b = { m: 1, run: F }; b.run(); show("14", a.seen.length, b.seen + 1); }
// 15: a getter on the prototype that stores on this
{ class C { constructor() { const first = this.lazy; this.seen = this.m; this.first = first; } get lazy() { this.m = 1; return 0; } } C.prototype.m = "proto"; show("15", new C().seen + 1); }
// 16: a method call on this finds an own function stored by the base
{ class B { constructor() { this.run = () => "own"; } } class C extends B { constructor() { super(); this.seen = this.run(); } run() { return 5; } } show("16", new C().seen.length); }
// 17: super() returns another object
{ class B { constructor() { return { m: 1 }; } } class C extends B { constructor() { super(); this.seen = this.m; } } C.prototype.m = "proto"; show("17", new C().seen + 1); }
// 18: the read is in a called method
{ class C { constructor() { this.m = 1; this.seen = this.peek(); } peek() { return this.m; } } C.prototype.m = "proto"; show("18", new C().seen + 1);
  class D { constructor() { this.seen = this.peek(); this.m = 1; } peek() { return this.m; } } D.prototype.m = "proto"; const d = new D(); show("18b", d.seen.length, d.peek() + 1); }
