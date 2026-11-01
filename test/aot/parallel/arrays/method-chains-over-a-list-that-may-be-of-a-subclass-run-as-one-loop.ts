// `list.filter(f).map(g)` where a list of a class that extends Array also reaches the function. The methods are then read by name, and what such
// a list's own `filter` makes goes to code that nobody sees, so the fields of the elements are only expected to hold what they are declared to hold.
// IR= 1 pricesOfEven NewArray(Like|WithCapacity)
// IR= 1 largeAmongPriced NewArray(Like|WithCapacity)
// IR= 1 amountsOfPart NewArray(Like|WithCapacity)
// IR= 0 totalOfEven NewArray(Like|WithCapacity)
interface Sale {
  customer: number;
  amount: number;
}
interface Priced {
  customer: number;
  price: number;
}
const sales: Sale[] = [];
for (let i = 0; i < 12; i++) sales.push({ customer: i % 5, amount: i * 7 });

function pricesOfEven(list: Sale[]): Priced[] {
  return list.filter(o => o.amount % 2 === 0).map(o => ({ customer: o.customer, price: o.amount + 1 }));
}
function largeAmongPriced(list: Sale[]): Priced[] {
  return list.map(o => ({ customer: o.customer, price: o.amount - 20 })).filter(p => p.price > 0);
}
function amountsOfPart(list: Sale[], from: number): number[] {
  return list.slice(from >>> 0).map(o => o.amount + 1);
}
function totalOfEven(list: Sale[]): number {
  return list
    .filter(o => o.amount % 2 === 0)
    .map(o => o.amount)
    .reduce((total, amount) => total + amount, 0);
}
function howManyLarge(list: Sale[]): number {
  return list.map(o => o.amount - 30).filter(x => x > 0).length;
}
function all(list: Sale[]): string {
  return [
    JSON.stringify(pricesOfEven(list)),
    JSON.stringify(largeAmongPriced(list)),
    amountsOfPart(list, 9).join(),
    totalOfEven(list),
    howManyLarge(list),
  ].join(" ");
}

let seen = 0;
for (let round = 0; round < 2000; round++)
  seen +=
    pricesOfEven(sales).length +
    largeAmongPriced(sales).length +
    amountsOfPart(sales, round & 7).length +
    totalOfEven(sales) +
    howManyLarge(sales);
console.log(seen);
console.log(all(sales));

class List<T> extends Array<T> {}
const list = new List<Sale>();
for (const o of sales) list.push(o);
console.log(
  pricesOfEven(list) instanceof List,
  largeAmongPriced(list) instanceof List,
  amountsOfPart(list, 2) instanceof List,
  all(list),
);

const said: string[] = [];
class Loud<T> extends Array<T> {
  filter(test: (value: T, index: number, array: T[]) => unknown): T[] {
    said.push("filter");
    return super.filter(test);
  }
  map<U>(make: (value: T, index: number, array: T[]) => U): U[] {
    said.push("map");
    return super.map(make);
  }
}
const loud = new Loud<Sale>();
for (const o of sales.slice(0, 4)) loud.push(o);
console.log(all(loud), said.join());

// An element in the middle or at the end is no longer what the callbacks expect. Each read is written down: the order is that of the methods, one after the other, and nothing is read twice.
function watched(customer: number, amount: unknown): Sale {
  const o = { customer, amount: 0 } as Sale;
  Object.defineProperty(o, "amount", {
    get() {
      said.push("amount of " + customer);
      return amount;
    },
    enumerable: true,
    configurable: true,
  });
  return o;
}
function attempt(what: string, run: () => unknown): void {
  said.length = 0;
  let answer = "";
  try {
    answer = JSON.stringify(run()) ?? "nothing";
  } catch (error) {
    answer = (error as Error).constructor.name + ": " + (error as Error).message;
  }
  console.log(what, answer, "|", said.join());
}
const runs: [string, (list: Sale[]) => unknown][] = [
  ["prices", pricesOfEven],
  ["large", largeAmongPriced],
  ["part", list => amountsOfPart(list, 1)],
  ["total", totalOfEven],
  ["how many", howManyLarge],
];
const withGetterLast = [sales[2]!, sales[4]!, watched(7, 40)];
const withGetterFirst = [watched(8, 42), sales[2]!, sales[4]!];
const withTwoGetters = [sales[6]!, watched(1, 44), sales[2]!, watched(2, 46)];
const withObjectAsAmount = [
  sales[2]!,
  watched(3, {
    valueOf() {
      said.push("valueOf");
      return 50;
    },
  }),
  sales[4]!,
];
const withThrowingGetter = [sales[2]!, sales[4]!, watched(4, 0)];
Object.defineProperty(withThrowingGetter[2]!, "amount", {
  get() {
    said.push("throws");
    throw new RangeError("no amount");
  },
});
for (const [name, run] of runs) {
  attempt(name + ", a getter at the end", () => run(withGetterLast));
  attempt(name + ", a getter in front", () => run(withGetterFirst));
  attempt(name + ", two getters", () => run(withTwoGetters));
  attempt(name + ", an object for a number", () => run(withObjectAsAmount));
  attempt(name + ", a getter that throws", () => run(withThrowingGetter));
}

const withoutField = [sales[2]!, { customer: 5, amount: 14 } as Sale, sales[4]!];
delete (withoutField[1] as Partial<Sale>).amount;
const withText = [sales[2]!, { customer: 6, amount: 14 } as Sale];
(withText[1] as unknown as { amount: string }).amount = "16";
const withMore = [sales[2]!, Object.assign({ customer: 6, amount: 18 }, { note: "more" }) as Sale];
const inherited = [sales[2]!, Object.create({ customer: 9, amount: 20 }) as Sale];
const withNull = [sales[2]!, sales[4]!, null as unknown as Sale];
for (const [name, run] of runs) {
  attempt(name + ", a field deleted", () => run(withoutField));
  attempt(name + ", a text for a number", () => run(withText));
  attempt(name + ", one field more", () => run(withMore));
  attempt(name + ", fields of the prototype", () => run(inherited));
  attempt(name + ", null at the end", () => run(withNull));
}

// The callback in front throws at the last element, the one behind at the first: the error is that of the one in front.
const bothFail = [{ customer: 1, amount: 2 } as Sale, sales[2]!, null as unknown as Sale];
Object.defineProperty(bothFail[0]!, "customer", {
  get() {
    said.push("customer throws");
    throw new SyntaxError("no customer");
  },
});
attempt("both fail", () => pricesOfEven(bothFail));

// A getter that changes the list while the first method runs.
const growing: Sale[] = [sales[2]!, sales[4]!];
growing.push(
  watched(5, {
    valueOf() {
      if (growing.length < 5) growing.push(sales[6]!);
      growing[0] = sales[8]!;
      return 60;
    },
  }),
);
for (const [name, run] of runs) {
  growing.length = 3;
  growing[0] = sales[2]!;
  attempt(name + ", the list changes", () => run(growing));
}
console.log(all(sales));
