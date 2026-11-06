// `list.filter(isOfOthers).map(priceOf)`: the callbacks are functions that are declared elsewhere, not arrows written in the call. Over a list that is not
// proven to be a plain array of what it is declared to hold, the chain is one loop and makes one list all the same.
// IR= 1 pricesOfOthers NewArray(Like|WithCapacity)
// IR= 0 totalOfOthers NewArray(Like|WithCapacity)
// IR@= 1 totalOfOthers = GetArrayElement
// IR= 1 report NewArray(Like|WithCapacity)
// IR= 0 totalFrom NewArray(Like|WithCapacity)
// IR@= 1 totalFrom = GetArrayElement
// A thousand rounds make two lists each. With a list for each method it is 7,000 and more.
// COUNT: cells <= 4000
// Alone: what the compiler knows of a list goes by all that the executable holds, and with it what is counted here
interface Sale {
  customer: number;
  amount: number;
}
const sales: Sale[] = [];
for (let i = 0; i < 40; i++) sales.push({ customer: i % 5, amount: i * 7 });

function isOfOthers(o: Sale): boolean {
  return o.customer !== 3;
}
function priceOf(o: Sale): number {
  return o.amount + 1;
}
function add(sum: number, x: number): number {
  return sum + x;
}
function pricesOfOthers(list: Sale[]): number[] {
  return list.filter(isOfOthers).map(priceOf);
}
function totalOfOthers(list: Sale[]): number {
  return list.filter(isOfOthers).map(priceOf).reduce(add, 0);
}

// The callbacks have captured a variable of the function that made them, and the function with the chain has captured the callbacks.
function reportAbove(limit: number, more: number): (list: Sale[]) => number[] {
  const isAbove = (o: Sale): boolean => o.amount > limit;
  const withMore = (o: Sale): number => o.amount + more;
  return function report(list: Sale[]): number[] {
    return list.filter(isAbove).map(withMore);
  };
}
const above70 = reportAbove(70, 1000);
const above140 = reportAbove(140, 2000);

// Read between the calls: where one method runs after the other, that is behind all that the methods in front have done.
let start = 0;
function totalFrom(list: Sale[]): number {
  return list.filter(isOfOthers).map(priceOf).reduce(add, start);
}

let seen = 0;
for (let round = 0; round < 1000; round++) {
  start = round & 3;
  seen += pricesOfOthers(sales).length + totalOfOthers(sales) + (round & 1 ? above70 : above140)(sales).length + totalFrom(sales);
}
console.log(seen);
start = 0;

function show(run: () => unknown): string {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
}
const chains: ((list: Sale[]) => unknown)[] = [pricesOfOthers, totalOfOthers, above70, above140, totalFrom];

class List<T> extends Array<T> {}
const few = new List<Sale>();
for (const o of sales.slice(9, 13)) few.push(o);
const parsed = JSON.parse(`[{"customer":1,"amount":4},{"customer":3,"amount":444},{"customer":2,"amount":144}]`) as Sale[];
for (const list of [sales.slice(8, 13), few, parsed, [], [sales[11]!, ...parsed], [sales[11], , sales[30]] as Sale[]])
  console.log(list.constructor.name, pricesOfOthers(list).constructor.name, above70(list).constructor.name, chains.map(run => show(() => run(list))).join(" "));

// What is no object, in front, in the middle and at the end.
for (const other of [undefined, null])
  for (const list of [
    [other, sales[11]],
    [sales[11], other, sales[12]],
    [sales[11], sales[12], other],
  ] as Sale[][])
    console.log(chains.map(run => show(() => run(list))).join(" | "));

// Each getter runs once, in the order of the methods.
const said: string[] = [];
function watched(name: string, customer: number, amount: number): Sale {
  return {
    get customer() {
      said.push(name + ".customer");
      return customer;
    },
    get amount() {
      said.push(name + ".amount");
      return amount;
    },
  };
}
for (const list of [
  [sales[11], watched("last", 2, 162)],
  [watched("first", 1, 114), sales[12], watched("last", 3, 162)],
] as Sale[][]) {
  for (const run of chains) {
    said.length = 0;
    console.log(run.name, show(() => run(list)), said.join(" "));
  }
}

// A getter writes the variable that is read between the calls.
const writesStart = [
  sales[1],
  {
    customer: 1,
    get amount() {
      start += 100000;
      return 21;
    },
  },
] as Sale[];
console.log(totalFrom(writesStart), start, totalFrom(writesStart), start, totalFrom(sales.slice(0, 2)), start);

// The variable of a callback may hold another function by the time it is read.
let price: (o: Sale) => number = priceOf;
function pricesByVariable(list: Sale[]): number[] {
  return list.filter(isOfOthers).map(price);
}
const writesPrice = [
  sales[1],
  {
    amount: 21,
    get customer() {
      price = o => -o.amount;
      return 1;
    },
  },
] as Sale[];
console.log(show(() => pricesByVariable(sales.slice(0, 3))), show(() => pricesByVariable(writesPrice)), show(() => pricesByVariable(sales.slice(0, 3))));

// A callback that is seen, and one that calls itself.
let calls = 0;
function isCounted(o: Sale): boolean {
  calls++;
  return o.customer !== 3;
}
function depthOf(o: Sale): number {
  return o.amount > 20 ? 1 + depthOf({ customer: o.customer, amount: o.amount >> 1 }) : 0;
}
console.log(show(() => sales.slice(0, 9).filter(isCounted).map(depthOf)), calls, show(() => ([sales[5], null] as Sale[]).filter(isCounted).map(depthOf)), calls);

// The callback of the chain is the function that the chain stands in, or one that comes back to it: to learn what the callback does the compiler reads it, and finds the same chain.
interface Tree {
  value: number;
  children: Tree[];
}
function sizeOf(node: Tree): number {
  return (
    1 +
    node.children
      .map(sizeOf)
      .filter(size => size > 0)
      .reduce(add, 0)
  );
}
function atEvenDepth(node: Tree): number {
  return (
    node.value +
    node.children
      .map(atOddDepth)
      .filter(sum => sum !== 0)
      .reduce(add, 0)
  );
}
function atOddDepth(node: Tree): number {
  return (
    -node.value +
    node.children
      .map(atEvenDepth)
      .filter(sum => sum !== 0)
      .reduce(add, 0)
  );
}
function grow(depth: number, value: number): Tree {
  const children: Tree[] = [];
  for (let i = 0; i < depth; i++) children.push(grow(depth - 1, value + i));
  return { value, children };
}
const grown = grow(4, 1);
const parsedTree = JSON.parse(`{"value":3,"children":[{"value":4,"children":[]},{"value":5,"children":[{"value":6,"children":[]}]}]}`) as Tree;
console.log(sizeOf(grown), atEvenDepth(grown), atOddDepth(grown), sizeOf(parsedTree), atEvenDepth(parsedTree), atOddDepth(parsedTree));
console.log(show(() => sizeOf({ value: 1, children: [grown, null] } as Tree)), show(() => atEvenDepth({ value: 1, children: [{ value: 2 }] } as Tree)));
