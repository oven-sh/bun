// RUN: lower
// OPTIONS: builtin-modules

// A bigint literal names a property of a binding pattern and of an assignment pattern by its decimal digits, never by the name of its target.
const source = { 1: "one", 2: "two", x: "wrong x", y: "wrong y", z: "wrong z" };

const { 1n: a, 2n: b = "unused default", 3n: c = "default" } = source;
console.log(a, b, c);

let x, y, z;
({ 1n: x, 2n: y = "unused default", 3n: z = "default" } = source);
console.log(x, y, z);

const { 1n: first, ...others } = source;
console.log(first, JSON.stringify(others));

let assignedFirst, assignedOthers;
({ 1n: assignedFirst, ...assignedOthers } = source);
console.log(assignedFirst, JSON.stringify(assignedOthers));

function parameters({ 2n: second }) {
  return second;
}
console.log(parameters(source));

for (const nullish of [null, undefined]) {
  try {
    ({ 1n: x } = nullish);
  } catch (error) {
    console.log(error.name);
  }
}

// GENERATED: parameters
// CHECK-LABEL: function {{*}}name="parameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="2"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = ElemGet v4, v5
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
