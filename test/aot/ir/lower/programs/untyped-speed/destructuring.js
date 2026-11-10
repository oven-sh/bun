// RUN: lower
// OPTIONS: builtin-modules

// Destructuring of parameters and variables: defaults, nested patterns, rest elements and rest properties, a swap, and objects returned only to be taken apart.
function area({ width = 1, height = 1, unit: { scale = 1 } = {} } = {}) {
  return width * height * scale;
}

function head([first, second = 10, ...others]) {
  return first + second + others.length;
}

function swap(pair) {
  let [a, b] = pair;
  [a, b] = [b, a];
  return a * 2 + b;
}

function pick(source, ...names) {
  const out = {};
  for (const name of names) out[name] = source[name];
  return out;
}

function omitId({ id, ...others }) {
  return others;
}

const describe = ({ name, tags: [firstTag = "none"] = [] }) => `${name}:${firstTag}`;

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function run(count) {
  const boxes = [{ width: 2, height: 3 }, { width: 4 }, { height: 5, unit: { scale: 2 } }, {}, undefined];
  const people = [{ id: 1, name: "ann", tags: ["x", "y"] }, { id: 2, name: "bob" }, { id: 3, name: "cy", tags: [] }];
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += area(boxes[i % 5]) + head([i & 3, 2, 3, 4]) + head([i & 1]) + swap([i & 7, 3]);
    const person = people[i % 3];
    total += describe(person).length;
    const { name, missing = 4 } = pick(person, "name", "id");
    total += name.length + missing;
    const { min, max } = minMax([i & 15, 7, i & 3]);
    total += max - min;
    if ((i & 3) === 0) total += Object.keys(omitId(person)).length;
  }
  return total;
}

console.log(run(700000));

// GENERATED: pick omitId
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: Array):
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v8 = ElemGet v0, v7
// CHECK-NEXT: ElemSet v2, v7, v8
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v3:
// CHECK-NEXT: v10 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="omitId"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_3]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="id"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="id"
// CHECK-NEXT: v6 = CopyObject v4 excludedKeys=["id"]
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
