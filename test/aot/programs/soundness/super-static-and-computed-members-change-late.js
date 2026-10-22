// super, static members, computed members and home objects whose chains change late.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
// 1: super.m() where the parent's prototype gets the method late
{ class A {} class B extends A { run() { return super.late ? super.late() : "none"; } } const b = new B(); show("1a", b.run()); chain(A.prototype).late = function () { return 7; }; show("1b", b.run() + 1); }
// 2: the prototype of the home object changes
{ class A { who() { return "A"; } } class Z { who() { return 26; } } class B extends A { who() { return super.who(); } } const b = new B(); show("2a", b.who().length); Object.setPrototypeOf(chain(B.prototype), Z.prototype); show("2b", b.who() + 1); }
// 3: super.x = v with a setter that appears late above the home object
{ const log = []; class A {} class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("3a", Object.keys(b).join(), b.x + 1);
  Object.defineProperty(chain(A.prototype), "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true }); const c = new B(); c.put(2); show("3b", Object.keys(c).join(), c.hidden + 1, log.join()); }
// 4: super in an object literal
{ const base = { hi() { return "base"; } }; const o = { __proto__: base, hi() { return super.hi(); } }; show("4a", o.hi().length); Object.setPrototypeOf(chain(o), { hi() { return 4; } }); show("4b", o.hi() + 1); }
// 5: static members through the chain of class objects
{ class A {} class B extends A {} function r(c) { return c.config; } show("5a", r(B)); chain(A).config = "static"; show("5b", r(B).length); Object.defineProperty(chain(B), "config", { get() { return 5; } }); show("5c", r(B) + 1, r(A).length); }
// 6: a static field under a computed key replaces a static method
{ const name = chain("make"); class A { static make() { return "method"; } static [name] = 6; } show("6", typeof A.make, A.make + 1); }
// 7: a computed method name that is one of two
{ function build(name) { return class { [name]() { return name; } }; } const X = build("a"), Y = build(chain("b")); show("7", new X().a(), typeof new X().b, new Y().b(), typeof new Y().a); }
// 8: a computed accessor whose name nobody can name
{ const name = dynamic("value"); class A { get [name]() { return "getter"; } set [name](v) { this.kept = v; } } const a = new A(); show("8a", a.value.length); a.value = 3; show("8b", a.kept + 1, Object.keys(a).join()); }
// 9: static super
{ class A { static make() { return "A"; } } class B extends A { static make() { return super.make(); } } show("9a", B.make().length); Object.setPrototypeOf(chain(B), { make() { return 9; } }); show("9b", B.make() + 1); }
// 10: a method borrowed by another object keeps its home object
{ class A { who() { return "A"; } } class B extends A { who() { return super.who(); } } const other = { who: B.prototype.who }; show("10a", other.who().length); chain(A.prototype).who = () => 10; show("10b", other.who() + 1); }
// 11: accessors that are inherited by two receivers get each receiver as this
{ class A { get me() { return this.tag; } set me(v) { this.tag = v; } } class B extends A {} class C extends A {} const b = new B(), c = new C(); function w(o, v) { o.me = v; } function r(o) { return o.me; }
  w(b, 1); show("11a", r(b) + 1, r(c)); w(chain(c), "text"); show("11b", r(b) + 1, r(c).length); }
