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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_2]]} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: PropSet v1, v2 key="own"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reflectConstruct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_7]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="kept"
// CHECK-NEXT: v6 = Builtin builtin=Reflect
// CHECK-NEXT: v7 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Data data=[[d_9]]
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v11 = Call v7, v6, v8, v9, v10 calleeName="Reflect.construct" [isDoneInPlace]
// CHECK-NEXT: PutModuleVariable v11 variable=[[g_8]]
// CHECK-NEXT: v13 = String string="|"
// CHECK-NEXT: v14 = Add v3, v13
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = ElemGet v0, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_11]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v18 = Add v14, v17
// CHECK-NEXT: v19 = String string="|"
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = Integer integer=1
// CHECK-NEXT: v22 = ElemGet v0, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_12]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v24 = Add v20, v23
// CHECK-NEXT: v25 = String string="|"
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: v27 = Integer integer=3
// CHECK-NEXT: v28 = ElemGet v0, v27
// CHECK-NEXT: v29 = Convert v28 declared={type=number site=[[w_13]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v30 = Add v26, v29
// CHECK-NEXT: v31 = String string="|"
// CHECK-NEXT: v32 = Add v30, v31
// CHECK-NEXT: v33 = PropGet v0 key="length"
// CHECK-NEXT: v34 = Convert v33 declared={type=number site=[[w_14]]} illTypedCause=Assertion
// CHECK-NEXT: v35 = Add v32, v34
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asyncGenerator6"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_16]]}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base5"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_17]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_17]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_18]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_19]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_19]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
