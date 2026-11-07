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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_3]]}] results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Negate v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_5]]}
// CHECK-NEXT: PropSet v0, v3 key="n"
// CHECK-NEXT: v5 = Convert v1 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="boundThisBesideTable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_6]]}] results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_8]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_1]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v4 = PropGet v3 key="bind"
// CHECK-NEXT: v5 = Call v4, v3, v2 calleeKey="bind" calleeName="add.bind"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v8 = PropGet v7 key="bind"
// CHECK-NEXT: v9 = Call v8, v7, v2 calleeKey="bind" calleeName="addTwice.bind"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewArray v6, v10 contents=undefined|null|[[f_13]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|[[f_13]]> site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Jump -> next b2(v14)
// CHECK-NEXT: b2(v15: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v17 = Convert v15 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v18 = Less v17, v0
// CHECK-NEXT: Branch v18 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v19, v20):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v21 = Convert v19 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = BitAnd v21, v22
// CHECK-NEXT: v24 = ElemGet v12, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[f_13]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = Call v25, v12, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v29 = Increment v21
// CHECK-NEXT: v30 = Convert v29 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Jump -> next b2(v30)
// CHECK-NEXT: b6(v31, v32):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v33 = PropGet v2 key="n"
// CHECK-NEXT: v34 = Convert v33 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dropLast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=undefined|null|Array<number> site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} parameters=[{type=number site=[[w_19]]}] results=[{type=number site=[[w_20]]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_22]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Sub v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_23]]}
// CHECK-NEXT: PropSet v0, v6 key="length"
// CHECK-NEXT: v8 = Convert v1 declared={type=number site=[[w_20]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Button"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_24]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[f_24]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_26]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_26]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_26]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_27]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[f_28]] site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v4, v6 key="onClick"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
