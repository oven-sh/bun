// RUN: lower
// OPTIONS: builtin-modules

// A bound function passes its own `this` and its own first arguments, whatever the call passes. What the target stores into them is seen by the caller, also where the call has a `this` of its own (a method call, a call of an element of a table) or arguments of its own
type Step = (value: number) => number;
type Cell = { n: number };

function add(this: Cell, value: number): number { this.n += value; return this.n }
function addTwice(this: Cell, value: number): number { this.n += 2 * value; return this.n }

function boundThisBesideTable(rounds: number): number {
  const target = { n: 0 };
  const table: Step[] = [add.bind(target), addTwice.bind(target)];
  for (let i = 0; i < rounds; i++) table[i & 1](1);
  return target.n;
}

function boundThisReadInTheLoop(rounds: number): number {
  const target = { n: 0 };
  const table: Step[] = [add.bind(target), addTwice.bind(target)];
  let seen = 0;
  for (let i = 0; i < rounds; i++) { table[i & 1](1); seen += target.n }
  return seen;
}

function boundThisBesideHolder(rounds: number): number {
  const target = { n: 1 };
  const holder = { n: 100, run: add.bind(target) as Step, other: addTwice.bind(target) as Step };
  let seen = 0;
  for (let i = 0; i < rounds; i++) { if (i & 1) holder.run(1); else holder.other(1); seen += target.n + holder.n }
  return seen;
}

function store(into: Cell, value: number): number { into.n = value; return value }
function storeNegative(into: Cell, value: number): number { into.n = -value; return value }
function boundArgument(rounds: number): number {
  const kept = { n: 0 };
  const table: Step[] = [store.bind(null, kept), storeNegative.bind(null, kept), store.bind(null, kept)];
  let sum = 0;
  for (let i = 0; i < rounds; i++) { table[i % 3](i); sum += kept.n }
  return sum;
}

type Fill = (other: Cell) => number;
function fill(first: Cell, second: Cell): number { first.n += 1; return second.n }
function fillTwice(first: Cell, second: Cell): number { first.n += 2; return second.n + 1 }
function boundArgumentBesideArgument(rounds: number): number {
  const first = { n: 0 }, passed = { n: 50 };
  const table: Fill[] = [fill.bind(null, first), fillTwice.bind(null, first)];
  let sum = 0;
  for (let i = 0; i < rounds; i++) { sum += table[i & 1](passed); sum += first.n + passed.n }
  return sum;
}

function lengthOf(this: number[], value: number): number { return value + this.length }
function dropLast(this: number[], value: number): number { this.length = this.length - 1; return value }
function storeFraction(this: number[], value: number): number { if (value + 1 < this.length) this[value + 1] = 0.5; return value }
function storeFarBehind(this: number[], value: number): number { if (this.length < 12) this[11] = value; return value }
function boundArray(change: (this: number[], value: number) => number): string {
  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  const table: Step[] = [lengthOf.bind(list), change.bind(list)];
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += (list[i] ?? 100) + table[i & 1](i);
  return sum + " " + list.join();
}

class Counter { n = 0; increment: () => void; constructor() { this.increment = this.step.bind(this) } step(): void { this.n++ } }
class Button { n = 1000; onClick: () => void; constructor(onClick: () => void) { this.onClick = onClick } }
function handlers(rounds: number): number {
  const counter = new Counter();
  const button = new Button(counter.increment);
  let seen = 0;
  for (let i = 0; i < rounds; i++) { button.onClick(); seen += counter.n }
  return seen + button.n;
}

for (let round = 0; round < 3; round++) {
  console.log("this beside a table", boundThisBesideTable(10 + round), boundThisReadInTheLoop(10 + round));
  console.log("this beside a holder", boundThisBesideHolder(10 + round));
  console.log("argument", boundArgument(10 + round), boundArgumentBesideArgument(10 + round));
  console.log("array", boundArray(lengthOf), "|", boundArray(dropLast), "|", boundArray(storeFraction), "|", boundArray(storeFarBehind));
  console.log("handlers", handlers(10 + round));
}

// GENERATED: storeNegative boundThisBesideTable dropLast Button
// CHECK-LABEL: function {{*}}name="storeNegative"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: number):
// CHECK-NEXT: v2 = Negate v1
// CHECK-NEXT: PropSet v0, v2 key="n"
// CHECK-NEXT: v4 = Convert v1 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="boundThisBesideTable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Data data=[[d_2]]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = PropGet v2 key="bind"
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeKey="bind" calleeName="add.bind"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = PropGet v6 key="bind"
// CHECK-NEXT: v8 = Call v7, v6, v1 calleeKey="bind" calleeName="addTwice.bind"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v10 = NewArray v5, v9 contents=undefined|null|[[f_6]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|[[f_6]]> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v13)
// CHECK-NEXT: b1(v14: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = Less v14, v0
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = BitAnd v14, v17
// CHECK-NEXT: v19 = ElemGet v11, v18
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Call v19, v11, v20
// CHECK-NEXT: v22 = Increment v14
// CHECK-NEXT: v23 = Convert v22 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v23)
// CHECK-NEXT: b3():
// CHECK-NEXT: v24 = PropGet v1 key="n"
// CHECK-NEXT: v25 = Convert v24 declared={type=number}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dropLast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Sub v2, v3
// CHECK-NEXT: PropSet v0, v4 key="length"
// CHECK-NEXT: v6 = Convert v1 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Button"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[f_7]]):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_8]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_8]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_9]]
// CHECK-NEXT: PropSet v4, v1 key="onClick"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
