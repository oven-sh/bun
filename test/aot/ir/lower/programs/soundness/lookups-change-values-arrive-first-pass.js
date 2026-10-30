// RUN: lower
// OPTIONS: builtin-modules

// What changes a lookup is reached only through a value that the analysis gets after its first pass has come to rest: a field read through a leak of this before its store.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function nothing() {}
function lateOf(late) {
  let leaked, seen;
  class Leaky { constructor() { leaked = this; seen = leaked.k; this.k = "a"; } }
  new Leaky();
  return { a: nothing, undefined: late }[seen];
}
// 1: a setter on the grandparent
{ const log = []; const top = {}, middle = Object.create(top), bottom = Object.create(middle); function w(o, v) { o.x = v; } w(Object.create(middle), 0);
  lateOf(() => { Object.defineProperty(top, "x", { set(v) { log.push(v); this.kept = v; } }); })(); w(bottom, 1); show("1", Object.keys(bottom).join(), bottom.kept + 1, log.join()); }
// 2: a getter on the grandparent
{ const top = {}, middle = Object.create(top), bottom = Object.create(middle); function r(o) { return o.x; } show("2a", r(bottom));
  lateOf(() => { Object.defineProperty(top, "x", { get() { return "getter"; } }); })(); show("2b", r(bottom).length); }
// 3: a new link
{ const top = {}, bottom = Object.create(top); function r(o) { return o.x; } show("3a", r(bottom)); lateOf(() => { Object.setPrototypeOf(top, { x: "linked" }); })(); show("3b", r(bottom).length); }
// 4: a field is deleted
{ const o = { __proto__: { x: "above" }, x: 1 }; function r(v) { return v.x; } show("4a", r(o) + 1); lateOf(() => { delete o.x; })(); show("4b", r(o).length); }
// 5: another key
{ const o = { a: 1, b: "text" }; let key = "a"; function r() { return o[key]; } show("5a", r() + 1); lateOf(() => { key = "b"; })(); show("5b", r().length); }
// 6: a store under a key nobody can name
{ const o = { a: 1 }; function r(v) { return v.a; } show("6a", r(o) + 1); lateOf(() => { o["ab".slice(0, 1)] = "text"; })(); show("6b", r(o).length); }
// 7: the setter of a class goes away
{ class C { set x(v) { this.kept = v; } } function w(o, v) { o.x = v; } const a = new C(); w(a, 1); lateOf(() => { delete C.prototype.x; })(); const b = new C(); w(b, 2); show("7", Object.keys(a).join(), Object.keys(b).join(), b.x + 1); }
// 8: a descriptor
{ const o = {}; let d; function define() { try { Object.defineProperty(o, "x", d); } catch (e) {} } define(); lateOf(() => { d = { get() { return "getter"; } }; })(); define(); show("8", o.x.length); }
// 9: the source of a copy grows
{ const source = { a: 1 }; function copy() { return { ...source }; } show("9a", copy().late); lateOf(() => { source.late = "text"; })(); show("9b", copy().late.length); }
// 10: the object escapes and is changed through what comes back
{ const o = { x: 1 }; function r(v) { return v.x; } show("10a", r(o) + 1); lateOf(() => { globalThis.lostValueLate = o; globalThis.lostValueLate.x = "text"; })(); show("10b", r(o).length); }
// 11: a member on the prototype of numbers
{ function r(v) { return v.lateMember; } show("11a", r(5)); lateOf(() => { Number.prototype.lateMember = "text"; })(); show("11b", r(5).length); delete Number.prototype.lateMember; }
// 12: a store in a constructor that is found late, before a read of this
{ let fill = nothing; class C { constructor() { fill(this); this.seen = this.m; } } C.prototype.m = "proto"; show("12a", new C().seen.length); lateOf(() => { fill = (o) => { o.m = 1; }; })(); show("12b", new C().seen + 1); }

// GENERATED: lateOf define Leaky set
// CHECK-LABEL: function {{*}}name="lateOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]]|[[f_6]]|[[f_7]]|[[f_8]]|[[f_9]]|[[f_10]]|[[f_11]]|[[f_12]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]]|[[f_6]]|[[f_7]]|[[f_8]]|[[f_9]]|[[f_10]]|[[f_11]]|[[f_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_13]]
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_13]]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_13]] field=1
// CHECK-NEXT: v7 = NewClosure v1 function=[[f_15]]
// CHECK-NEXT: v8 = NewClass v7 layout=[[L_14]]
// CHECK-NEXT: v9 = FinishClass v8 layout=[[L_14]]
// CHECK-NEXT: v10 = Convert v9 declared={type=[[f_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = Convert v9 declared={type=[[f_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = Construct v11 calleeName="Leaky"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_17]] flags=[IsExpected]}
// CHECK-NEXT: v15 = NewObject layout=[[L_18]]
// CHECK-NEXT: PropDefine v15, v14 key="a"
// CHECK-NEXT: PropDefine v15, v0 key="undefined"
// CHECK-NEXT: v18 = FinishObject v15
// CHECK-NEXT: v19 = GetEnvironmentField v1 layout=[[L_13]] field=1
// CHECK-NEXT: v20 = CheckInitialized v19 name="seen"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined flags=[IsExpected]}
// CHECK-NEXT: v22 = ElemGet v18, v21
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="define"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="o"
// CHECK-NEXT: v4 = String string="x"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="d"
// CHECK-NEXT: v7 = Call v1, v0, v3, v4, v6 calleeName="Object.defineProperty"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Leaky"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] captures=[{type=env [[L_13]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: env [[L_13]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_14]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_14]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_13]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="leaked"
// CHECK-NEXT: v7 = Convert v4 declared={type=undefined|null|[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v7 layout=[[L_13]]
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_13]] field=1
// CHECK-NEXT: v10 = CheckInitialized v9 name="seen"
// CHECK-NEXT: v11 = GetEnvironmentField v0 layout=[[L_13]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="leaked"
// CHECK-NEXT: v13 = PropGet v12 key="k"
// CHECK-NEXT: PutEnvironmentField v0, v13 layout=[[L_13]] field=1
// CHECK-NEXT: v15 = Convert v4 declared={type=undefined|null|[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="a"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v15, v17 key="k"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v21):
// CHECK-NEXT: Jump -> next b4(v21)
// CHECK-NEXT: b3(v22):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=undefined|null|number|string|symbol|bigint|[[L_21]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_21]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_23]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_24]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v1 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: PropSet v0, v1 key="kept"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
