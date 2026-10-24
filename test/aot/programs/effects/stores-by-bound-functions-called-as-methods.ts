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
