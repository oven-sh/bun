// RUN: lower
// OPTIONS: builtin-modules

// An object literal with a getter stands in code that a constant condition cuts. Its type is still named by what is left.
const enabled = false;
function make(n: number) {
  return enabled ? { get value() { return n * 2; }, n } : { value: n, n };
}
type Made = ReturnType<typeof make>;
function show(made: Made): string { return made.value + ":" + made.n; }
console.log(show(make(2)));
function other(n: number) {
  if (false) { const lazy = { get twice() { return n * 2; }, set twice(value: number) { n = value; }, n }; return lazy; }
  return undefined;
}
function use(it: ReturnType<typeof other>): number { return it === undefined ? -1 : it.twice + it.n; }
console.log(use(other(3)));
const kept = true;
function makeKept(n: number) {
  return kept ? { get value() { return n * 2; }, n } : { value: n, n };
}
function showKept(made: ReturnType<typeof makeKept>): string { return made.value + ":" + made.n + ":" + typeof Object.getOwnPropertyDescriptor(made, "value")!.get; }
console.log(showKept(makeKept(2)));

// GENERATED: make use makeKept showKept value
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="enabled"
// CHECK-NEXT: v3 = Convert v0 declared={type=number}
// CHECK-NEXT: v4 = Convert v0 declared={type=number}
// CHECK-NEXT: v5 = NewObject -, v3, v4 layout=[[L_5]] fields=[1, 0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="use"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[IsExpected, OmitsNull]}] results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Integer integer=-1
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = PropGet v4 key="twice"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v4 key="n"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeKept"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_9]]}] results=[{type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="kept"
// CHECK-NEXT: v3 = NewObject layout=[[L_10]]
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_13]]
// CHECK-NEXT: DefineGetter v3, v4 key="value"
// CHECK-NEXT: v6 = Convert v0 declared={type=number}
// CHECK-NEXT: PropDefine v3, v6 key="n"
// CHECK-NEXT: v8 = FinishObject v3
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="showKept"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = String string=":"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="n"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v10 = String string="value"
// CHECK-NEXT: v11 = Call v9, v8, v0, v10 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="get"
// CHECK-NEXT: v14 = TypeOf v13
// CHECK-NEXT: v15 = Add v7, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] captures=[{type=number site=[[w_9]]}] thisType={type=anything} results=[{type=number site=[[w_16]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
