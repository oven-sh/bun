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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_1]] fields=[0]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="kept"
// CHECK-NEXT: v4 = GetEnvironmentField v1 layout=[[L_1]]
// CHECK-NEXT: v5 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v6 = NewObject -, v5 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = PropGet v7 key="m"
// CHECK-NEXT: v9 = Call v8, v7 calleeKey="m" calleeName="m"
// CHECK-NEXT: v10 = GetEnvironmentField v1 layout=[[L_1]]
// CHECK-NEXT: v11 = NewArray v4, v9, v10 contents=anything
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_2]]
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = LShift v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_1]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
