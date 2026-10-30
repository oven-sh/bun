// RUN: lower
// OPTIONS: builtin-modules

// One statement of the module enters a function, which is entered again by another way (static through this): each run has its own captured variable.
const log = [], readers = [];
class Holder { static once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) this.once(); mine += 10; log.push(mine); } }
Holder.once();
console.log(log.join(), readers.map(read => read()).join());

// GENERATED: Holder once
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_4]]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="readers"
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_4]]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="readers"
// CHECK-NEXT: v9 = PropGet v8 key="push"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewClosure v1 function=[[f_7]]
// CHECK-NEXT: v12 = Call v10, v8, v11 calleeKey="push" calleeName="readers.push"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="readers"
// CHECK-NEXT: v15 = PropGet v14 key="length"
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = Integer integer=3
// CHECK-NEXT: v18 = Less v16, v17
// CHECK-NEXT: Branch v18 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v19 = Convert v0 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="once"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v21, v19 calleeKey="once" calleeName="this.once"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v23 = GetEnvironmentField v1 layout=[[L_4]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="mine"
// CHECK-NEXT: v25 = Integer integer=10
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v28 = GetEnvironmentField v1 layout=[[L_4]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="mine"
// CHECK-NEXT: PutEnvironmentField v1, v27 layout=[[L_4]]
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v32 = CheckInitialized v31 name="log"
// CHECK-NEXT: v33 = PropGet v32 key="push"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v35 = GetEnvironmentField v1 layout=[[L_4]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="mine"
// CHECK-NEXT: v37 = Call v34, v32, v36 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v38 = Undefined
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
