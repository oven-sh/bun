// The calls of `list.filter(f).map(g)` stand in small functions, and a long function with several loops calls those. It is called twice, so each of its loops counts as code that runs often
// and the small functions are copied into it. The copies share the allowance of the long function: where the bodies alone had spent it, every filter() and map() inside them was refused,
// and each copy made a list for each method and a call for each element, which the small function by itself does not. So a body asks for the room of its methods with its own,
// and where there is none the small function stays a call.
// About twice what arrays/method-chains-make-no-list-between-their-methods-in-an-executable.ts makes: 50,769. With the half copies it was 84,551.
// COUNT: cells <= 52000
// Alone: what the compiler knows of a list goes by all that the executable holds, and with it what is counted here
interface Sale {
  customer: number;
  amount: number;
}
interface Priced {
  customer: number;
  price: number;
}
const sales: Sale[] = [];
for (let i = 0; i < 40; i++) sales.push({ customer: i % 5, amount: i * 7 });

function pricesOfEven(list: Sale[]): Priced[] {
  return list.filter(o => o.amount % 2 === 0).map(o => ({ customer: o.customer, price: o.amount + 1 }));
}
function totalOfOthers(list: Sale[]): number {
  return list
    .filter(o => o.customer !== 3)
    .map(o => o.amount + o.customer)
    .reduce((sum, x) => sum + x, 0);
}
function howManyLarge(list: Sale[]): number {
  return list.map(o => o.amount - 30).filter(x => x > 0).length;
}
function sumOfPart(list: Sale[], from: number): number {
  return list
    .slice(from >>> 0)
    .map(o => o.amount)
    .reduce((sum, x) => sum + x, 0);
}
// Here the program itself decides between the two methods.
function pricesIfAsked(list: Sale[], asked: boolean): unknown[] {
  const even = list.filter(o => o.amount % 2 === 0);
  if (asked) return even.map(o => o.amount + 1);
  return even;
}
function pricesOfOwnLists(list: Sale[]): unknown[] {
  const even = list.filter(o => o.amount % 2 === 0);
  return even instanceof List ? even.map(o => o.amount + 1) : even;
}
function pricesOfArrays(list: Sale[]): unknown[] {
  const even = list.filter(o => o.amount % 2 === 0);
  return Array.isArray(even) ? even.map(o => o.amount + 1) : even;
}
function pricesAndHowMany(list: Sale[]): string {
  const even = list.filter(o => o.amount % 2 === 0);
  const prices = even.map(o => o.amount + 1);
  return prices.join() + " of " + even.length;
}

class List<T> extends Array<T> {}
const few = new List<Sale>();
for (const o of sales.slice(0, 4)) few.push(o);
const parsed = JSON.parse(`[{"customer":1,"amount":4},{"customer":3,"amount":44}]`) as Sale[];

function main() {
let seen = 0;
for (let round = 0; round < 1000; round++) {
  const made = pricesOfEven(sales);
  seen +=
    made.length +
    made[made.length - 1]!.price +
    totalOfOthers(sales) +
    howManyLarge(sales) +
    sumOfPart(sales, round & 31);
}
console.log(seen);
for (const list of [sales.slice(0, 5), few, parsed, [], [sales[1]!, ...parsed]])
  console.log(
    list.constructor.name,
    pricesOfEven(list).constructor.name,
    JSON.stringify(pricesOfEven(list)),
    totalOfOthers(list),
    howManyLarge(list),
    sumOfPart(list, 1),
  );

for (const list of [sales.slice(0, 5), few, parsed])
  console.log(
    JSON.stringify(pricesIfAsked(list, true)),
    JSON.stringify(pricesIfAsked(list, false)),
    JSON.stringify(pricesOfOwnLists(list)),
    JSON.stringify(pricesOfArrays(list)),
    pricesAndHowMany(list),
  );
let others = 0;
for (let round = 0; round < 300; round++)
  others +=
    pricesIfAsked(sales, (round & 1) === 0).length +
    pricesOfOwnLists(sales).length +
    pricesOfArrays(sales).length +
    pricesAndHowMany(sales).length;
console.log(others);

// What the program can see happens in the order of the methods, once.
const said: string[] = [];
const watched = { customer: 2, amount: 0 } as Sale;
Object.defineProperty(watched, "amount", {
  get() {
    said.push("amount");
    return 62;
  },
});
for (const list of [
  [sales[2]!, watched],
  [watched, sales[2]!, sales[39]!],
]) {
  for (const run of [pricesOfEven, totalOfOthers, howManyLarge, (list: Sale[]) => sumOfPart(list, 0)]) {
    said.length = 0;
    console.log(JSON.stringify(run(list)), said.length);
  }
}

// The constructor of the list that `filter` makes is asked for before the first callback runs.
const ofSpecies = [sales[2]!, sales[4]!];
(ofSpecies as unknown as { constructor: unknown }).constructor = { [Symbol.species]: List };
console.log(pricesOfEven(ofSpecies) instanceof List, JSON.stringify(pricesOfEven(ofSpecies)), totalOfOthers(ofSpecies));

}
main(); main();
