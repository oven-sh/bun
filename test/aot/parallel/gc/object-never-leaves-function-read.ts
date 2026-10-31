// Objects, lists and closures that never leave the function that makes them hold the only way to new objects while something is thrown and caught.
// Env: BUN_JSC_gcMaxHeapSize=1
// Env: BUN_JSC_collectContinuously=1
// Env: BUN_JSC_forceDidDeferGCWork=1
// Env: BUN_JSC_useZombieMode=1
// Env: BUN_JSC_scribbleFreeCells=1
class Item {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

class Pair {
  first: Item;
  second: Item;
  constructor(first: Item, second: Item) {
    this.first = first;
    this.second = second;
  }
}

let caught: unknown = null;

function sumOf(pair: Pair): number {
  let sum = 0;
  for (let i = 0; i < 2; i++) sum += i === 0 ? pair.first.value : pair.second.value;
  return sum;
}

function apply(callback: (n: number) => number, n: number): number {
  let sum = 0;
  for (let i = 0; i < 2; i++) sum += callback(n + i);
  return sum;
}

function total(list: Item[]): number {
  let sum = 0;
  for (const item of list) sum += item.value;
  return sum;
}

function pairs(round: number, maybe: { x: number } | null): number {
  const pair = new Pair(new Item(round), new Item(round + 1));
  let seen = sumOf(pair);
  try {
    seen += maybe!.x;
  } catch (error) {
    caught = error;
    seen += sumOf(pair);
  }
  return seen + sumOf(pair);
}

function closures(round: number, maybe: { x: number } | null): number {
  const item = new Item(round);
  const other = new Item(round + 2);
  const add = (n: number) => n + item.value + other.value;
  let seen = apply(add, 1);
  try {
    seen += maybe!.x;
  } catch (error) {
    caught = error;
    seen += apply(add, 2);
  }
  return seen + apply(add, 3);
}

function lists(round: number, maybe: { x: number } | null): number {
  const list = [new Item(round), new Item(round + 1), new Item(round + 2)];
  let seen = total(list);
  try {
    seen += maybe!.x;
  } catch (error) {
    caught = error;
    seen += total(list);
  }
  return seen + total(list);
}

function filledInTheHandler(round: number, maybe: { x: number } | null): number {
  const pair = new Pair(new Item(round), new Item(round + 1));
  try {
    pair.first = new Item(maybe!.x);
  } catch (error) {
    caught = error;
    pair.second = new Item(round + 5);
  }
  return sumOf(pair);
}

function inCleanups(round: number, maybe: { x: number } | null): number {
  const pair = new Pair(new Item(round), new Item(round + 1));
  let seen = 0;
  try {
    try {
      seen += maybe!.x;
    } finally {
      seen += sumOf(pair);
    }
  } catch (error) {
    caught = error;
    seen += sumOf(pair);
  }
  return seen;
}

function* items(round: number): Generator<Item> {
  try {
    yield new Item(round);
    yield new Item(round + 1);
  } finally {
    closed++;
  }
}
let closed = 0;

function overAnIterator(round: number, maybe: { x: number } | null): number {
  const pair = new Pair(new Item(round), new Item(round + 1));
  let seen = 0;
  try {
    for (const item of items(round)) seen += item.value + maybe!.x;
  } catch (error) {
    caught = error;
    seen += sumOf(pair);
  }
  return seen + sumOf(pair);
}

const nothing: { x: number } | null = process.env.SOMETHING ? { x: 1 } : null;
const rounds = 3000;
let sum = 0;
for (let round = 0; round < rounds; round++)
  sum +=
    pairs(round, nothing) +
    closures(round, nothing) +
    lists(round, nothing) +
    filledInTheHandler(round, nothing) +
    inCleanups(round, nothing) +
    overAnIterator(round, nothing);
console.log(sum, closed, caught instanceof Error ? caught.name : String(caught));
