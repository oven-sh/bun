// RUN: lower
// OPTIONS: builtin-modules

// The name comes out of one object and is looked for in another.
function copy(names, from) {
  const found = [];
  for (const name in names) found.push(name, typeof from[name], from[name] === Object);
  return found.join();
}
console.log(copy({ constructor: 1, toString: 1, a: 1 }, { a: 2 }));
console.log(copy(JSON.parse('{"constructor":1,"__proto__":2,"valueOf":3}'), { a: 2 }));
function sameTextOtherValue(o, other) {
  const found = [];
  for (const name in o) { const target = found.length ? other : o; found.push(typeof target[name]); }
  return found.join();
}
console.log(sameTextOtherValue({ a: 1, constructor: 2 }, {}));

// GENERATED: copy sameTextOtherValue
// CHECK-LABEL: function {{*}}name="copy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = ForInOpen v0
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = ForInStep v5, v0
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v4 declared={type=undefined|null|Array<undefined|null|boolean|string> flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10 calleeKey="join" calleeName="found.join"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v4 key="push"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v17 = ElemGet v1, v14
// CHECK-NEXT: v18 = TypeOf v17
// CHECK-NEXT: v19 = ElemGet v1, v14
// CHECK-NEXT: v20 = Builtin builtin=Object
// CHECK-NEXT: v21 = StrictEq v19, v20
// CHECK-NEXT: v22 = Call v16, v4, v14, v18, v21 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sameTextOtherValue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = ForInOpen v0
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = ForInStep v5, v0
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10 calleeKey="join" calleeName="found.join"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v4 key="length"
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = ToBoolean v16
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b9(v1)
// CHECK-NEXT: b7(v19):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9(v0)
// CHECK-NEXT: b9(v20):
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v4 key="push"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v24 = ElemGet v21, v14
// CHECK-NEXT: v25 = TypeOf v24
// CHECK-NEXT: v26 = Call v23, v4, v25 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: }
