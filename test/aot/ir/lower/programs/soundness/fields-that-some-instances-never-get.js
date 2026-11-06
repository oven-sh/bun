// RUN: lower
// OPTIONS: builtin-modules

// A lookup ends at a field that is assumed to be filled.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
function read(o) { return o.x; }
// 1: stored on one path of the constructor
{ class C { constructor(f) { if (f) this.x = 1; } } C.prototype.x = "proto"; function r(o) { return o.x; } show("1", r(new C(true)) + 1, r(new C(false)).length); }
// 2: the constructor leaves early
{ class C { constructor(f) { if (!f) return; this.x = 1; } } C.prototype.x = "proto"; function r(o) { return o.x; } show("2", r(new C(true)) + 1, r(new C(false)).length); }
// 3: stored by a helper that a subclass replaces
{ class C { constructor() { this.init(); } init() { this.x = 1; } } class D extends C { init() {} } C.prototype.x = "proto"; function r(o) { return o.x; } show("3", r(new C()) + 1, r(new D()).length); }
// 4: the object leaks before the store, and the reader runs then
{ const seen = []; function r(o) { return o.x; } function peek(o) { seen.push(typeof r(o)); } class C { constructor() { peek(this); this.x = 1; peek(this); } } C.prototype.x = "proto"; new C(); show("4", seen.join()); }
// 5: the constructor throws after the leak
{ let leaked; function r(o) { return o.x; } class C { constructor() { leaked = this; throw new Error("stop"); this.x = 1; } } C.prototype.x = "proto"; try { new C(); } catch (e) {} show("5", r(leaked).length); }
// 6: a getter above a field that is deleted in a function reached through that getter's result
{ const proto = { get x() { return () => "from getter"; } }; const o = { __proto__: proto, x: null }; function r(v) { return v.x; } show("6a", r(o)); delete chain(o).x; show("6b", r(o)()); }
// 7: an inherited field of a subclass instance
{ class B { constructor(f) { if (f) this.x = 1; } } class C extends B { constructor(f) { super(f); this.y = 2; } } B.prototype.x = "proto"; function r(o) { return o.x; } show("7", r(new C(true)) + 1, r(new C(false)).length); }
// 8: Reflect.construct: the constructor of the new target never runs
{ class A { constructor() { this.a = 1; } } class B { constructor() { this.x = 1; } } B.prototype.x = "proto"; function r(o) { return o.x; } show("8", r(new B()) + 1, r(Reflect.construct(A, [], B)).length); }
// 9: Object.create of the class prototype
{ class B { constructor() { this.x = 1; } } B.prototype.x = "proto"; function r(o) { return o.x; } show("9", r(new B()) + 1, r(Object.create(B.prototype)).length); }
// 10: a method of the same name above a field that is emptied late, called
{ class B { x() { return "method"; } } class C extends B { constructor() { super(); this.x = () => 7; } } const o = new C(); function call(v) { return v.x(); } show("10a", call(o) + 1); delete chain(o).x; show("10b", call(o).length); }
// 11: `in` with a field that goes away
{ const proto = {}; const o = { __proto__: proto, x: 1 }; function has(v) { return "x" in v; } show("11a", has(o)); delete chain(o).x; show("11b", has(o)); chain(proto).x = 1; show("11c", has(o)); }
// 12: a literal field under a key nobody can name is deleted, then the prototype gets the name late
{ const proto = {}; const o = { __proto__: proto, x: 1 }; function r(v) { return v.x; } show("12a", r(o) + 1); delete o[dynamic("x")]; show("12b", r(o)); chain(proto).x = "late"; show("12c", r(o).length); }
// 13: the field is emptied through a receiver nobody tracks, after the reader ran
{ const proto = { x: "proto" }; const o = { __proto__: proto, x: 1 }; function r(v) { return v.x; } show("13a", r(o) + 1); globalThis.lostBox13 = o; const u = globalThis.lostBox13; delete u[dynamic("x")]; show("13b", r(o).length); }
// 14: an accessor defined through a receiver nobody tracks
{ const o = { x: 1 }; function r(v) { return v.x; } show("14a", r(o) + 1); globalThis.lostBox14 = o; Object.defineProperty(globalThis.lostBox14, "x", { get() { return "getter"; } }); show("14b", r(o).length); }

// GENERATED: dynamic read D peek x A has
// CHECK-LABEL: function {{*}}name="dynamic"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="!"
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = PropGet v2 key="slice"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v4, v2, v5, v7 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="read"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="peek"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="seen"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v6 = Call v5, -, v0 calleeName="r"
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = Call v4, v2, v7 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_9]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_11]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_11]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="a"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="method"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropHas v0 key="x"
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
