// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: run Z put build w me C
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="late"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v7 = GetSuperBase v6 homeKind=ClassPrototype
// CHECK-NEXT: v8 = SuperGet v7, v0 key="late"
// CHECK-NEXT: v9 = Call v8, v0 calleeName="super.late"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = String string="none"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Z"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_5]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: [[L_5]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = GetSuperBase v2 homeKind=ClassPrototype
// CHECK-NEXT: SuperSet v3, v0, v1 key="x"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="build"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_9]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_10]]
// CHECK-NEXT: v3 = ToPropertyKey v0
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_11]]
// CHECK-NEXT: SetFunctionName v4, v3
// CHECK-NEXT: DefineMethod v2, v4, v3 layout=[[L_10]]
// CHECK-NEXT: v7 = FinishClass v2 layout=[[L_10]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="w"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_12]] flags=[IsExpected]}, {type=undefined|null|number|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_12]], v1: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: PropSet v0, v1 key="me"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="me"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_13]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="tag"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="me"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_13]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_13]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="tag"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_15]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
