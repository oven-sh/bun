// RUN: lower
// OPTIONS: builtin-modules

/** @typedef {{ x: number, y: number }} Point */

/**
 * @this {Point}
 * @param {number} n
 * @returns {number}
 */
function shifted(n) {
  return this.x + this.y + n;
}

/** @enum {number} */
const Level = { Low: 1, Middle: 2, High: 3 };

/** @enum {string} */
const Color = { Red: "red", Green: "green" };

/** @enum {(n: number) => number} */
const Steps = { up: /** @param {number} n */ n => n + 1, down: /** @param {number} n */ n => n - 1 };

/**
 * @param {Level} level
 * @returns {string}
 */
function levelName(level) {
  switch (level) {
    case Level.Low:
      return "low";
    case Level.High:
      return "high";
    default:
      return "middle";
  }
}

/**
 * @interface
 */
class Shape {
  /** @returns {number} */
  area() {
    return 0;
  }
}

/** @implements {Shape} */
class Square {
  /** @param {number} side */
  constructor(side) {
    this.side = side;
  }
  area() {
    return this.side * this.side;
  }
}

/**
 * @template T
 */
class Stack {
  constructor() {
    /** @type {T[]} */
    this.items = [];
  }
  /** @param {T} item */
  push(item) {
    this.items.push(item);
    return this;
  }
  /** @returns {T | undefined} */
  top() {
    return this.items[this.items.length - 1];
  }
}

/** @extends {Stack<number>} */
class Numbers extends Stack {
  /** @returns {number} */
  total() {
    let sum = 0;
    for (const n of this.items) sum += n;
    return sum;
  }

  /**
   * @override
   * @param {number} item
   */
  push(item) {
    return super.push(item * 2);
  }
}

class Account {
  /** @private */
  secret = 1;
  /** @protected */
  shared = 2;
  /** @public */
  open = 3;
  /** @readonly */
  fixed = 4;
  /** @returns {number} */
  all() {
    return this.secret + this.shared + this.open + this.fixed;
  }
}

/**
 * @param {Shape} shape
 * @returns {number}
 */
function twiceTheArea(shape) {
  return shape.area() * 2;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += shifted.call({ x: i, y: 1 }, 1) + levelName(Level.High).length + twiceTheArea(new Square(i % 5)) + Steps.up(i) + new Numbers().push(i).total();
console.log("2000 rounds: " + warm);
console.log(shifted.call({ x: 1, y: 2 }, 3), shifted.apply({ x: 1, y: 2 }, [3]), shifted.bind({ x: 1, y: 2 })(3), [1, 2].map(shifted, { x: 1, y: 2 }).join());
console.log(levelName(Level.Low), levelName(Level.Middle), Color.Red + Color.Green, Steps.down(1), Object.keys(Level).join());
console.log(new Square(3).area(), twiceTheArea(new Shape()), new Square(1) instanceof Shape);
console.log(new Numbers().push(1).push(2).total(), new Numbers().top(), new Account().all(), new Account().open, Object.keys(new Account()).join());

export {};

// GENERATED: Stack push Numbers total
// CHECK-LABEL: function {{*}}name="Stack"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = Data data=[[d_3]]
// CHECK-NEXT: PropSet v3, v4 key="items"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v3)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="items"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeKey="push" calleeName="this.items.push"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_6]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_6]]):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v0 key="items"
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v4
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v10 = Add v5, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v11)
// CHECK-NEXT: b5() role=IterationCleanup subject=v4:
// CHECK-NEXT: v12 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_6]] flags=[IsExpected]} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: [[L_6]], v1: number):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v3 = GetSuperBase v2 homeKind=ClassPrototype
// CHECK-NEXT: v4 = SuperGet v3, v0 key="push"
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Mul v1, v5
// CHECK-NEXT: v7 = Call v4, v0, v6 calleeName="super.push"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
