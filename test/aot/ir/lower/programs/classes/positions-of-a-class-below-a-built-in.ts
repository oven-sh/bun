// RUN: lower
// OPTIONS: builtin-modules

// The constructor of a built-in allocates the instances of a class below it, so no instance carries the layout of the class. A position written with the class expects the layout and tests nothing, the members of the class are read by name and tested, and `this` in a method and the object a constructor made are expected too. A class below a class of the program keeps its layout.
class Q<T> extends Promise<T> {
  status = 0;
  #handle: number | null = null;
  run(): number { this.status |= 1; return this.status + (this.#handle ?? 0); }
  then<R1 = T, R2 = never>(onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: any) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2> { this.run(); return super.then(onFulfilled, onRejected); }
}
class Rows<T> extends Array<T> {
  count: number | null = null;
  constructor(values?: T[]) { super(); if (values !== undefined) for (let i = 0; i < values.length; i++) this[i] = values[i]!; }
}
class Oops extends Error { code = 7; }
class Plain { x = 1; }
class Below extends Plain { y = 2; }
class BelowError extends Oops { more = 1; }
function useQuery(q: Q<number>): number { return q.run() + q.status; }
function useRows(r: Rows<number>): number { return (r.count ?? 0) + r.length; }
function useOops(e: Oops): number { return e.code + e.message.length; }
function useBelow(b: Below): number { return b.x + b.y; }
function useBelowError(b: BelowError): number { return b.more + b.code; }
function makeRows(): Rows<number> { return new Rows([1, 2]); }
const q = new Q<number>(resolve => resolve(1));
console.log(useQuery(q), useRows(makeRows()), useOops(new Oops("m")), useBelow(new Below()), useBelowError(new BelowError("x")));

// GENERATED: useQuery useRows useOops useBelow useBelowError makeRows run Rows
// CHECK-LABEL: function {{*}}name="useQuery"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="run"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="run" calleeName="q.run"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v4 = PropGet v0 key="status"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="useRows"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Convert v1 declared={type=null|number site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="useOops"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="code"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = PropGet v0 key="message"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Add v2, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="useBelow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_15]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="useBelowError"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_16]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_17]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="more"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = PropGet v0 key="code"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_19]]} illTypedCause=Assertion
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeRows"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Rows"
// CHECK-NEXT: v2 = Data data=[[d_21]]
// CHECK-NEXT: v3 = Construct v1, -, v2 calleeName="Rows"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=number site=[[w_22]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="status"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = BitOr v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_23]]}
// CHECK-NEXT: PropSet v0, v4 key="status"
// CHECK-NEXT: v6 = PropGet v0 key="status"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_24]]} illTypedCause=Assertion
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_25]]
// CHECK-NEXT: v9 = PrivateGet v0, v8 layout=[[L_1]] field=2
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = Add v7, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_22]]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Rows"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_26]]> site=[[w_27]] flags=[OmitsNull]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|Array<undefined|null|[[L_26]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_5]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_5]] flags=[IsFromCompiler, IsExpected]}
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b22(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_28]]
// CHECK-NEXT: v10 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_29]]}
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b6(v15: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v17 = Convert v15 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v12 key="length"
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_30]]} illTypedCause=Assertion
// CHECK-NEXT: v20 = Less v17, v19
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b12(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v22 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b10(v25):
// CHECK-NEXT: v26 = Convert v21 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v27 = ElemGet v12, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[L_26]] site=[[w_31]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: ElemSet v25, v26, v28
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v30 = Increment v26
// CHECK-NEXT: v31 = Convert v30 declared={type=number site=[[w_29]]}
// CHECK-NEXT: Jump -> next b6(v31)
// CHECK-NEXT: b12(v32):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: v34 = TypeTest v33 testedType=object
// CHECK-NEXT: Branch v34 -> taken b15(| 0), notTaken b16(| 0)
// CHECK-NEXT: b15(v35):
// CHECK-NEXT: Jump -> next b20(v35)
// CHECK-NEXT: b16(v36):
// CHECK-NEXT: v37 = TypeTest v36 testedType=undefined
// CHECK-NEXT: Branch v37 -> taken b17(| 0), notTaken b21(| 0)
// CHECK-NEXT: b17(v38):
// CHECK-NEXT: v39 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v39 -> taken b18(| 0), notTaken b19(| 0)
// CHECK-NEXT: b18(v40) frequency=Unlikely:
// CHECK-NEXT: v41 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v41
// CHECK-NEXT: b19(v42):
// CHECK-NEXT: Jump -> next b20(v42)
// CHECK-NEXT: b20(v43):
// CHECK-NEXT: Return v43
// CHECK-NEXT: b21(v44) frequency=Unlikely:
// CHECK-NEXT: v45 = NewRuntimeError runtimeError=DerivedConstructorResult name="Rows"
// CHECK-NEXT: Throw v45
// CHECK-NEXT: b22(v46) frequency=Unlikely:
// CHECK-NEXT: v47 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v47
// CHECK-NEXT: }
