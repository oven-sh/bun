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
function aboveLimit(list: Sale[], limit: number): number[] {
  return list.filter(o => o.amount > limit).map(o => o.amount - limit);
}
function totalOfEven(list: Sale[]): number {
  return list
    .filter(o => o.amount % 2 === 0)
    .map(o => o.amount)
    .reduce((total, amount) => total + amount, 0);
}
function firstLarge(list: Sale[]): Sale | undefined {
  return list.filter(o => o.customer !== 3).find(o => o.amount > 20);
}

let seen = 0;
for (let round = 0; round < 2000; round++) {
  seen += pricesOfEven(sales).length + largeAmongPriced(sales).length + aboveLimit(sales, round & 15).length + totalOfEven(sales);
  seen += firstLarge(sales)!.amount;
}
console.log(seen);

// Parsed text has the same fields in no layout of the program, so each callback finds out at its head.
const parsed = JSON.parse(`[{"customer":1,"amount":4},{"customer":2,"amount":5},{"customer":3,"amount":40}]`) as Sale[];
console.log(JSON.stringify(pricesOfEven(parsed)), JSON.stringify(largeAmongPriced(parsed)), aboveLimit(parsed, 4).join(), totalOfEven(parsed), firstLarge(parsed)?.amount);

// The tests fail at a late element, and what stands behind them shows in which order the callbacks ran.
const said: string[] = [];
function watched(name: string, customer: number, amount: number): any {
  const element = JSON.parse("{}");
  Object.defineProperty(element, "customer", { enumerable: true, get: () => (said.push(name + ".customer"), customer) });
  Object.defineProperty(element, "amount", { enumerable: true, get: () => (said.push(name + ".amount"), amount) });
  return element;
}
function show(what: string, run: () => unknown): void {
  said.length = 0;
  let result = "";
  try {
    result = JSON.stringify(run()) ?? "nothing";
  } catch (error) {
    result = (error as Error).constructor.name + ": " + (error as Error).message;
  }
  console.log(what, result, said.join(" "));
}
const lateWatched = [sales[2]!, sales[4]!, watched("a", 7, 4), sales[6]!, watched("b", 8, 6)];
show("filter, map", () => pricesOfEven(lateWatched));
show("map, filter", () => largeAmongPriced(lateWatched));
show("captures", () => aboveLimit(lateWatched, 3));
show("reduce", () => totalOfEven(lateWatched));
show("find", () => firstLarge([sales[4]!, watched("c", 1, 2), sales[6]!, watched("d", 2, 3)])?.amount);

const withoutAmount = JSON.parse(`{"customer":1}`);
Object.defineProperty(withoutAmount, "amount", {
  get() {
    throw new RangeError("no amount");
  },
});
const throwing = [sales[2]!, withoutAmount as Sale, sales[4]!];
show("a getter that throws", () => pricesOfEven(throwing));
show("null behind a getter", () => pricesOfEven([watched("e", 1, 2), null as unknown as Sale]));
show("null in front of a getter", () => pricesOfEven([null as unknown as Sale, watched("f", 1, 2)]));
show("a number", () => pricesOfEven([sales[2]!, 5 as unknown as Sale, sales[4]!]));
show("what a map callback gives the next", () => largeAmongPriced([watched("g", 1, 30), sales[6]!]));
