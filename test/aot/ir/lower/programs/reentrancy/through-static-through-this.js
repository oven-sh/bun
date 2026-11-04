// RUN: lower
// OPTIONS: builtin-modules

// One statement of the module enters a function, which is entered again by another way (static through this): each run has its own captured variable.
const log = [], readers = [];
class Holder { static once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) this.once(); mine += 10; log.push(mine); } }
Holder.once();
console.log(log.join(), readers.map(read => read()).join());

// GENERATED: Holder once
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="readers"
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_2]]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="readers"
// CHECK-NEXT: v9 = PropGet v8 key="push"
// CHECK-NEXT: v10 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="push" calleeName="readers.push"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="readers"
// CHECK-NEXT: v14 = PropGet v13 key="length"
// CHECK-NEXT: v15 = Integer integer=3
// CHECK-NEXT: v16 = Less v14, v15
// CHECK-NEXT: Branch v16 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v17 = PropGet v0 key="once"
// CHECK-NEXT: v18 = Call v17, v0 calleeKey="once" calleeName="this.once"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v19 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="mine"
// CHECK-NEXT: v21 = Integer integer=10
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v24 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="mine"
// CHECK-NEXT: PutEnvironmentField v1, v23 layout=[[L_2]]
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="log"
// CHECK-NEXT: v29 = PropGet v28 key="push"
// CHECK-NEXT: v30 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="mine"
// CHECK-NEXT: v32 = Call v29, v28, v31 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
