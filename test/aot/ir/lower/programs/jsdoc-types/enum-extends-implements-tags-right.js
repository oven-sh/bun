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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Data data=[[d_3]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<undefined|null|[[L_4]]> flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v7 key="items"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="items"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|[[L_4]]> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v1 calleeKey="push" calleeName="this.items.push"
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_8]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="items"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v6 = IteratorOpen v5
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v6
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v13 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v14 = Add v7, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v15)
// CHECK-NEXT: b7() role=IterationCleanup subject=v6:
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v6 completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_8]] flags=[IsExpected]} parameters=[{type=number flags=[IsExpected]}] results=[{type=undefined|null|[[L_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: [[L_8]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v3 = GetSuperBase v2 homeKind=ClassPrototype
// CHECK-NEXT: v4 = SuperGet v3, v0 key="push"
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Mul v1, v5
// CHECK-NEXT: v7 = Call v4, v0, v6 calleeName="super.push"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|[[L_8]] flags=[IsExpected]}}]
// CHECK-NEXT: }
