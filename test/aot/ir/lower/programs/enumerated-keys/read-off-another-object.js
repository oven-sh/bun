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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|object):
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = ForInOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = ForInStep v3, v0
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = PropGet v2 key="join"
// CHECK-NEXT: v9 = Call v8, v2 calleeKey="join" calleeName="found.join"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = PropGet v2 key="push"
// CHECK-NEXT: v11 = ElemGet v1, v7
// CHECK-NEXT: v12 = TypeOf v11
// CHECK-NEXT: v13 = ElemGet v1, v7
// CHECK-NEXT: v14 = Builtin builtin=Object
// CHECK-NEXT: v15 = StrictEq v13, v14
// CHECK-NEXT: v16 = Call v10, v2, v7, v12, v15 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sameTextOtherValue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|object):
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = ForInOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = ForInStep v3, v0
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = PropGet v2 key="join"
// CHECK-NEXT: v9 = Call v8, v2 calleeKey="join" calleeName="found.join"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = PropGet v2 key="length"
// CHECK-NEXT: v11 = ToBoolean v10
// CHECK-NEXT: Branch v11 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Jump -> next b6(v1)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: Jump -> next b6(v0)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = PropGet v2 key="push"
// CHECK-NEXT: v16 = ElemGet v14, v7
// CHECK-NEXT: v17 = TypeOf v16
// CHECK-NEXT: v18 = Call v15, v2, v17 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: }
