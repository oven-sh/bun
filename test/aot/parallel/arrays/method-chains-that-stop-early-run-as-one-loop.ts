// `list.map(f).find(g)`: `find` stops at the first element that it takes, and by then `map` has run on every element. As one loop there is no list between
// the two methods, and the callback of `map` still runs on the elements behind the answer: what it does there can be seen, or is thrown.
// IR@= 1 firstLarge = GetArrayElement
// IR= 0 firstLarge NewArray(Like|WithCapacity)
// IR@= 1 whereLarge = GetArrayElement
// IR= 0 whereLarge NewArray(Like|WithCapacity)
// IR@= 1 hasAmount = GetArrayElement
// IR= 0 hasAmount NewArray(Like|WithCapacity)
// IR@= 1 allBelow = GetArrayElement
// IR= 0 allBelow NewArray(Like|WithCapacity)
// IR@= 1 firstOfOthers = GetArrayElement
// IR= 0 firstOfOthers NewArray(Like|WithCapacity)
// A thousand rounds of five chains make no list. With a list for each method in front of the last it is 6,000 lists and more.
// COUNT: cells <= 3000
// Alone: what the compiler knows of a list goes by all that the executable holds, and with it what is counted here
interface Sale {
  customer: number;
  amount: number;
}
const sales: Sale[] = [];
for (let i = 0; i < 40; i++) sales.push({ customer: i % 5, amount: i * 7 });

function firstLarge(list: Sale[], limit: number): number | undefined {
  return list.map(o => o.amount + o.customer).find(x => x > limit);
}
function whereLarge(list: Sale[], limit: number): number {
  return list.map(o => o.amount + o.customer).findIndex(x => x > limit);
}
function hasAmount(list: Sale[], amount: number): boolean {
  return list.filter(o => o.customer !== 3).some(o => o.amount === amount);
}
function allBelow(list: Sale[], limit: number): boolean {
  return list
    .filter(o => o.customer !== 3)
    .map(o => o.amount)
    .every(x => x < limit);
}
function firstOfOthers(list: Sale[], limit: number): Sale | undefined {
  return list.filter(o => o.customer !== 3).find(o => o.amount > limit);
}
const chains: ((list: Sale[], limit: number) => unknown)[] = [firstLarge, whereLarge, hasAmount, allBelow, firstOfOthers];

let seen = 0;
for (let round = 0; round < 1000; round++) {
  const limit = (round % 50) * 7;
  seen += firstLarge(sales, limit) ?? 1;
  seen += whereLarge(sales, limit);
  if (hasAmount(sales, limit)) seen += 2;
  if (allBelow(sales, limit)) seen += 3;
  seen += firstOfOthers(sales, limit)?.amount ?? 5;
}
console.log(seen);

function show(run: () => unknown): string {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
}

class List<T> extends Array<T> {}
const few = new List<Sale>();
for (const o of sales.slice(0, 4)) few.push(o);
const parsed = JSON.parse(`[{"customer":1,"amount":4},{"customer":3,"amount":44},{"customer":2,"amount":14}]`) as Sale[];
for (const list of [sales.slice(0, 5), few, parsed, [], [sales[1]!, ...parsed]])
  for (const limit of [-1, 7, 14, 1000]) console.log(list.constructor.name, limit, chains.map(run => show(() => run(list, limit))).join(" "));

// `find` and `findIndex` look at a hole, `map` does not; behind a `filter` there is none.
const holes = [sales[1], , sales[9], ,] as Sale[];
console.log(chains.map(run => show(() => run(holes, 1000))).join(" "));
console.log(
  show(() => holes.map(o => o.amount).find(x => x === undefined)),
  show(() => holes.map(o => o.amount).findIndex(x => x === undefined)),
  show(() => holes.map(o => o.amount).findIndex((x, at) => at === 3)),
  show(() => holes.filter(o => o.amount > 0).findIndex(x => x === undefined)),
);

// The answer is the first element. What is no object stands behind it, and the method in front throws there.
for (const last of [undefined, null])
  for (const list of [
    [sales[2], sales[4], last],
    [sales[2], last, sales[4]],
    [last, sales[2]],
  ] as Sale[][])
    console.log(chains.map(run => show(() => run(list, run === hasAmount ? 14 : run === allBelow ? 0 : -1))).join(" | "));

// A getter of an element behind the answer runs, once, and in the order of the methods.
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
  [sales[2], watched("last", 2, 62)],
  [sales[2], watched("middle", 1, 62), sales[4]],
  [watched("first", 1, 14), sales[2], watched("last", 3, 62)],
] as Sale[][]) {
  for (const run of chains) {
    said.length = 0;
    console.log(run.name, show(() => run(list, run === hasAmount ? 14 : run === allBelow ? 0 : -1)), said.join(" "));
  }
}

// The callback in front is seen on every element, whatever the one behind it takes.
function amountsSeen(list: Sale[], limit: number): string {
  const amounts: number[] = [];
  const found = list
    .map(o => {
      amounts.push(o.amount);
      return o.amount;
    })
    .find(x => x > limit);
  return found + ": " + amounts.join();
}
let counted = 0;
function countsAll(list: Sale[], limit: number): boolean {
  return list
    .filter(o => {
      counted++;
      return o.customer !== 3;
    })
    .some(o => o.amount > limit);
}
console.log(amountsSeen(sales.slice(0, 6), 7), amountsSeen(sales.slice(0, 6), 1000), amountsSeen(few, -1));
console.log(countsAll(sales, 7), counted, countsAll(sales, 1000), counted, countsAll(parsed, 0), counted);

// The one behind throws at the first element, the one in front at the last: the error is that of the one in front.
function bothThrow(list: Sale[]): boolean {
  return list.map(o => o.amount.toFixed(1)).some(text => (text as unknown as { missing: string }).missing.length > 0);
}
console.log(show(() => bothThrow([sales[1], sales[2], {}] as Sale[])), show(() => bothThrow([sales[1]!, sales[2]!])), show(() => bothThrow([])));

// A getter makes the list shorter, or longer, while the method in front runs.
const changes: ((list: Sale[]) => unknown)[] = [list => list.pop(), list => list.push(sales[30]!), list => (list[2] = sales[31]!), list => delete list[2]];
for (const change of changes) {
  for (const run of chains) {
    const list = [sales[1], null, sales[9], sales[12]] as Sale[];
    list[1] = {
      customer: 1,
      get amount() {
        change(list);
        return 21;
      },
    };
    console.log(run.name, show(() => run(list, run === hasAmount ? 217 : 100)), list.length);
  }
}

// `this` of each callback, and the position that the last callback is told: the one in the list of the method in front of it.
console.log(
  sales
    .map(
      function (this: { more: number }, o) {
        return o.amount + this.more;
      },
      { more: 1 },
    )
    .findIndex(
      function (this: { wanted: number }, x) {
        return x === this.wanted;
      },
      { wanted: 22 },
    ),
  sales.filter(o => o.customer === 4).findIndex((o, at) => at === 2),
  sales.filter(o => o.customer === 4).find((o, at) => at === 2)!.amount,
  sales.filter((o, at) => at % 2 === 1).map((o, at) => o.amount + at).findIndex((x, at) => at === 3 && x === 52),
);
