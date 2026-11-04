// RUN: lower
// OPTIONS: builtin-modules

// A frozen array is the `prototype` of a function, of a base class or of a generator function. The first construction makes it a prototype, between two reads of one function. Each function is called where the compiler sees the call.
let kept: unknown;
function attempt(f: () => string): string { try { return f(); } catch (e) { return (e as Error).constructor.name; } }
const which = process.argv[2];

const a1 = Object.freeze([1, 2, 3, 4]);
function Made1(this: any) { this.own = 1; }
Made1.prototype = a1;
function construct(a: readonly number[]): string { const x = a[0]; kept = new (Made1 as any)(); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a2 = Object.freeze([1, 2, 3, 4]);
function Base2() {}
Base2.prototype = a2;
function classOver(a: readonly number[]): string { const x = a[0]; class Derived extends (Base2 as any) {} kept = Derived; return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a3 = Object.freeze([1, 2, 3, 4]);
function* generator3() { yield 1; }
generator3.prototype = a3;
function generate(a: readonly number[]): string { const x = a[0]; kept = generator3(); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a4 = Object.freeze([1, 2, 3, 4]);
function Made4() {}
Made4.prototype = a4;
function reflectConstruct(a: readonly number[]): string { const x = a[0]; kept = Reflect.construct(Object, [], Made4); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a5 = Object.freeze([1, 2, 3, 4]);
class Base5 { own = 1; }
function Target5() {}
Target5.prototype = a5;
function reflectConstructClass(a: readonly number[]): string { const x = a[0]; kept = Reflect.construct(Base5, [], Target5); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a6 = Object.freeze([1, 2, 3, 4]);
async function* asyncGenerator6() { yield 1; }
asyncGenerator6.prototype = a6;
function generateAsync(a: readonly number[]): string { const x = a[0]; kept = asyncGenerator6(); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a7 = Object.freeze([1, 2, 3, 4]);
function createNull(a: readonly number[]): string { const x = a[0]; kept = Object.create(a); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a8 = Object.freeze([1, 2, 3, 4]);
function Made8() {}
function storePrototype(a: readonly number[]): string { const x = a[0]; Made8.prototype = a; return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a9 = Object.freeze([1, 2, 3, 4]);
function bound(a: readonly number[]): string { const x = a[0]; const f = function () {}; Object.setPrototypeOf(f, a); kept = f.bind(null); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

if (!which || which === "construct") console.log("construct", attempt(() => construct(a1)), attempt(() => construct(a1)));
if (!which || which === "classOver") console.log("classOver", attempt(() => classOver(a2)), attempt(() => classOver(a2)));
if (!which || which === "generate") console.log("generate", attempt(() => generate(a3)), attempt(() => generate(a3)));
if (!which || which === "reflectConstruct") console.log("reflectConstruct", attempt(() => reflectConstruct(a4)), attempt(() => reflectConstruct(a4)));
if (!which || which === "reflectConstructClass") console.log("reflectConstructClass", attempt(() => reflectConstructClass(a5)), attempt(() => reflectConstructClass(a5)));
if (!which || which === "generateAsync") console.log("generateAsync", attempt(() => generateAsync(a6)), attempt(() => generateAsync(a6)));
if (!which || which === "createNull") console.log("createNull", attempt(() => createNull(a7)), attempt(() => createNull(a7)));
if (!which || which === "storePrototype") console.log("storePrototype", attempt(() => storePrototype(a8)), attempt(() => storePrototype(a8)));
if (!which || which === "bound") console.log("bound", attempt(() => bound(a9)), attempt(() => bound(a9)));

// GENERATED: Made1 reflectConstruct asyncGenerator6 Base5 Derived
// CHECK-LABEL: function {{*}}name="Made1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: PropSet v0, v1 key="own"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reflectConstruct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="kept"
// CHECK-NEXT: v5 = Builtin builtin=Reflect
// CHECK-NEXT: v6 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Data data=[[d_3]]
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Call v6, v5, v7, v8, v9 calleeName="Reflect.construct"
// CHECK-NEXT: PutModuleVariable v10 variable=[[g_2]]
// CHECK-NEXT: v12 = String string="|"
// CHECK-NEXT: v13 = Add v2, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = ElemGet v0, v14
// CHECK-NEXT: v16 = Add v13, v15
// CHECK-NEXT: v17 = String string="|"
// CHECK-NEXT: v18 = Add v16, v17
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = ElemGet v0, v19
// CHECK-NEXT: v21 = Add v18, v20
// CHECK-NEXT: v22 = String string="|"
// CHECK-NEXT: v23 = Add v21, v22
// CHECK-NEXT: v24 = Integer integer=3
// CHECK-NEXT: v25 = ElemGet v0, v24
// CHECK-NEXT: v26 = Add v23, v25
// CHECK-NEXT: v27 = String string="|"
// CHECK-NEXT: v28 = Add v26, v27
// CHECK-NEXT: v29 = PropGet v0 key="length"
// CHECK-NEXT: v30 = Add v28, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asyncGenerator6"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base5"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_6]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
