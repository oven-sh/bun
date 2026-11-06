// RUN: lower
// OPTIONS: builtin-modules

// A list names a parameter on both sides of a call that stores an int32 to it and is kept in a variable of the module.
let kept;
const f = (n) => { kept = [n, ({ m() { return n <<= 1; } }).m(), n]; };
f(2.5);
for (const e of kept) console.log(e);
console.log(kept.map((e) => e * 2).join());

// GENERATED: f m
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="kept"
// CHECK-NEXT: v4 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v5 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = NewObject layout=[[L_6]]
// CHECK-NEXT: PropDefine v7, v6 key="m"
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = PropGet v9 key="m"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9 calleeKey="m" calleeName="m"
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v14 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v15 = NewArray v4, v13, v14 contents=anything
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v16 variable=[[g_3]]
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = LShift v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_2]]
// CHECK-NEXT: v6 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
