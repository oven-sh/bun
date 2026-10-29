// RUN: lower
// OPTIONS: builtin-modules

/** @type {number} */
let count = 0;

/** @type {string} */
const name = "counter";

/** @type {number[]} */
const sizes = [1, 2, 3];

/** @type {{ x: number, y: number }} */
const origin = { x: 1, y: 2 };

/** @type {Map<string, number>} */
const byName = new Map();

/** @type {(n: number) => number} */
const double = n => n * 2;

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) {
  return a + b;
}

/**
 * @param {{ x: number, y: number }} p
 * @returns {number}
 */
function sum(p) {
  return p.x + p.y;
}

/**
 * @param {number[]} list
 * @returns {number}
 */
function total(list) {
  let result = 0;
  for (const n of list) result += n;
  return result;
}

/**
 * @param {string} text
 * @return {number}
 */
const size = text => text.length;

class Counter {
  /** @type {number} */
  n = 0;

  /** @type {string[]} */
  log = [];

  /** @param {number} start */
  constructor(start) {
    this.n = start;
    /** @type {number} */
    this.step = 1;
  }

  /**
   * @param {number} by
   * @returns {number}
   */
  add(by) {
    this.n += by * this.step;
    return this.n;
  }

  /** @returns {number} */
  get twice() {
    return this.n * 2;
  }

  /** @param {number} value */
  set twice(value) {
    this.n = value / 2;
  }

  /**
   * @param {number} n
   * @returns {Counter}
   */
  static from(n) {
    return new Counter(n);
  }
}

for (let i = 0; i < 2000; i++) {
  count = add(count, i % 3);
  count += sum(origin) + total(sizes) + double(i % 2) + size(name);
  byName.set("k" + (i % 4), count);
}
console.log("count: " + count);
console.log("map: " + [...byName].join(" "));

const counter = Counter.from(1);
for (let i = 0; i < 2000; i++) counter.add(i % 2);
counter.twice = counter.twice + 2;
console.log("counter: " + counter.n + " " + counter.twice + " " + counter.step + " " + JSON.stringify(counter));
console.log("kinds: " + [typeof count, typeof name, typeof double, typeof counter.n, Array.isArray(sizes)].join(" "));

export {};

// GENERATED: total Counter twice from
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Add v4, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_2]]
// CHECK-NEXT: v6 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v7 key="n"
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v9, v11 key="step"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = TypeTest v13 testedType=object
// CHECK-NEXT: Branch v14 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v15):
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="n"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Div v1, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v5 key="n"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="from"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Counter"
// CHECK-NEXT: v3 = Construct v2, -, v0 calleeName="Counter"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
