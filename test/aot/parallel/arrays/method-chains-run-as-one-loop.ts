// IR= 1 filterThenMap NewArray(Like|WithCapacity)
// IR= 1 mapThenFilter NewArray(Like|WithCapacity)
// IR= 1 mapThenMap NewArray(Like|WithCapacity)
// IR= 1 fourStages NewArray(Like|WithCapacity)
// IR= 0 greatestThroughAMadeFunction NewArray(Like|WithCapacity)
// IR= 0 greatestThroughAMadeFunction : =?L[0-9]+ = NewObject
// IR= 0 reduceToARecord NewArray(Like|WithCapacity)
// IR= 0 countThatPass NewArray(Like|WithCapacity)
// IR= 0 countAfterTwoStages NewArray(Like|WithCapacity)
// IR= 0 searches NewArray(Like|WithCapacity)
// IR= 2 numbers NewArray(Like|WithCapacity)
// IR= 0 sumOfNumbers NewArray(Like|WithCapacity)
// IR= 1 partOfTheList NewArray(Like|WithCapacity)
// IR= 4 partOfTheList LoopHint
interface Sale {
  customer: number;
  kind: string;
  amount: number;
}
interface Priced {
  customer: number;
  price: number;
}
interface Span {
  least: number;
  most: number;
}
const kinds = ["small", "large", "returned"];
const sales: Sale[] = [];
for (let i = 0; i < 12; i++) sales.push({ customer: i % 5, kind: kinds[i % 3]!, amount: i * 7 });

function whatIsOwedAbove(limit: number): (o: Sale) => number {
  return o => (o.amount > limit && o.kind !== "returned" ? o.amount - limit : -1);
}

function filterThenMap(list: Sale[]): Priced[] {
  let last: Priced[] = [];
  for (let round = 0; round < 2; round++) last = list.filter(o => o.amount % 2 === round).map(o => ({ customer: o.customer, price: o.amount + 1 }));
  return last;
}
function mapThenFilter(list: Sale[]): Priced[] {
  let last: Priced[] = [];
  for (let round = 0; round < 2; round++) last = list.map(o => ({ customer: o.customer, price: o.amount - 20 - round })).filter(p => p.price > 0);
  return last;
}
function mapThenMap(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = list.map(o => o.amount + round).map(x => x * 2);
  return last;
}
function fourStages(list: Sale[], least: number): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(o => o.customer !== 3)
      .map(o => ({ customer: o.customer, price: o.amount * 2 + round }))
      .filter(p => p.price >= least)
      .map(p => p.price + p.customer);
  }
  return last;
}
function greatestThroughAMadeFunction(list: Sale[]): number {
  let answer = 0;
  for (let limit = 5; limit < 50; limit += 20) {
    const owed = whatIsOwedAbove(limit);
    answer = answer * 100 + list
      .map(o => ({ customer: o.customer + 1, price: owed(o) }))
      .filter(p => p.price !== -1)
      .filter(p => p.customer !== 2)
      .reduce((greatest, p) => (p.price * p.customer > greatest ? p.price * p.customer : greatest), 0);
  }
  return answer;
}
function reduceToARecord(list: Sale[]): Span {
  let last: Span = { least: 0, most: 0 };
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(o => o.customer !== round)
      .map(o => ({ least: o.amount - o.customer, most: o.amount + round }))
      .reduce((all: Span, one: Span): Span => ({ least: Math.min(all.least, one.least), most: Math.max(all.most, one.most) }), { least: 1000, most: -1000 });
  }
  return last;
}
function countThatPass(list: Sale[]): number {
  let total = 0;
  for (let round = 0; round < 3; round++) total += list.filter(o => o.customer === round).length;
  return total;
}
function countAfterTwoStages(list: Sale[]): number {
  let total = 0;
  for (let round = 0; round < 3; round++) total += list.map(o => o.amount - round * 30).filter(x => x > 0).length;
  return total;
}
function searches(list: Sale[]): string {
  let text = "";
  for (let round = 0; round < 4; round++) {
    const some = list.filter(o => o.customer === round).some(o => o.kind === "returned");
    const every = list.filter(o => o.customer === round).every(o => o.amount > 6);
    const found = list.map(o => ({ customer: o.customer, price: o.amount * 3 })).find(p => p.price > 60 * round);
    const index = list.filter(o => o.kind !== "small").findIndex(o => o.amount > 20 * round);
    const indexOfMapped = list.map(o => o.amount).findIndex(x => x === 21 * round);
    text += `${some} ${every} ${found === undefined ? "none" : found.customer + ":" + found.price} ${index} ${indexOfMapped};`;
  }
  return text;
}
function numbers(list: number[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = list.filter(x => x % 2 === 0).map(x => x * 10 + round);
  return last;
}
function sumOfNumbers(list: number[]): number {
  let total = 0;
  for (let round = 0; round < 2; round++) total += list.filter(x => x > round).map(x => x / 2).reduce((sum, x) => sum + x, 0);
  return total;
}
function mayMakeNaN(list: number[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = list.map(x => x - 1).map(x => Math.sqrt(x) * 0 + x / (x - 1 + round));
  return last;
}
function partOfTheList(list: Sale[], from: number, to: number): string {
  let text = "";
  const start = from >>> 0;
  const end = to >>> 0;
  for (let round = 0; round < 2; round++) {
    const amounts = list.slice(start, end).map(o => o.amount + round);
    const sum = list.slice(start).filter(o => o.amount > 20).reduce((total, o) => total + o.amount, 0);
    const count = list.slice(1, 5).filter(o => o.kind !== "small").length;
    text += `${amounts.join()} ${amounts.length} ${sum} ${count};`;
  }
  return text;
}
function customersOf(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = list.filter(o => o.amount > 10).map(o => o.customer);
  return last;
}
function firstLarge(list: Sale[]): boolean {
  let answer = false;
  for (let round = 0; round < 2; round++) answer = list.filter(o => o.amount >= 0).some(o => o.kind === "large");
  return answer;
}

console.log(JSON.stringify(filterThenMap(sales)));
console.log(JSON.stringify(mapThenFilter(sales)));
console.log(mapThenMap(sales).join(), fourStages(sales, 60).join());
console.log(greatestThroughAMadeFunction(sales), JSON.stringify(reduceToARecord(sales)));
console.log(countThatPass(sales), countAfterTwoStages(sales), searches(sales));
console.log(partOfTheList(sales, 2, 6), partOfTheList(sales, 0, 100), partOfTheList(sales, 7, 3), partOfTheList(sales, 50, 60), partOfTheList([], 0, 1));
console.log(filterThenMap([]).length, greatestThroughAMadeFunction([]), JSON.stringify(reduceToARecord([])), searches([]));

const made = filterThenMap(sales);
console.log(Array.isArray(made), made.length, Object.keys(made).join(), made.constructor === Array);
made.push({ customer: 9, price: 9 });
made.length = 3;
console.log(made.length, JSON.stringify(made[made.length - 1]));
const few = sales.slice(0, 12);
for (let round = 0; round < 2; round++) {
  const one = few.filter(o => o.amount === 77).map(o => o.customer);
  one.push(round);
  console.log(one.length, one.join());
}

console.log(numbers([1, 2, 3, 4, 5, 6]).join(), numbers([1.5, 2, 4.5, 8]).join(), numbers([]).join());
console.log(sumOfNumbers([1, 2, 3]), sumOfNumbers([0.5, 1.5, 2.5]), sumOfNumbers([NaN, 1, Infinity]), mayMakeNaN([1, 2, 3, 0]).join());

const withHoles: Sale[] = new Array<Sale>(6);
withHoles[1] = sales[4]!;
withHoles[4] = sales[6]!;
console.log(JSON.stringify(filterThenMap(withHoles)), JSON.stringify(mapThenFilter(withHoles)), Object.keys(mapThenMap(withHoles)).join(), countThatPass(withHoles));
const numbersWithHoles = [1.5, , 2.5, , 4];
console.log(Object.keys(numbers(numbersWithHoles as number[])).join(), sumOfNumbers(numbersWithHoles as number[]));

const withNull: Sale[] = [sales[2]!, null as unknown as Sale, sales[4]!];
const withUndefined: Sale[] = [sales[2]!, sales[4]!, undefined as unknown as Sale];
function attempt(what: string, run: () => unknown): void {
  let said = "";
  try {
    said = JSON.stringify(run()) ?? "nothing";
  } catch (error) {
    said = (error instanceof TypeError) + " " + (error as Error).constructor.name;
  }
  console.log(what, said);
}
attempt("null, array", () => customersOf(withNull));
attempt("undefined, array", () => customersOf(withUndefined));
attempt("null, reduce", () => greatestThroughAMadeFunction(withNull));
attempt("undefined, four stages", () => fourStages(withUndefined, 0));
attempt("null, count", () => countThatPass(withNull));
attempt("a null behind the element that decides", () => firstLarge([sales[1]!, sales[4]!, null as unknown as Sale]));
attempt("null, searches", () => searches(withNull));
attempt("holes, searches", () => searches(withHoles));

class List<T> extends Array<T> {}
const list = new List<Sale>();
for (const o of sales) list.push(o);
const fromList = filterThenMap(list);
console.log(fromList instanceof List, fromList.length, JSON.stringify(fromList[0]), greatestThroughAMadeFunction(list), countThatPass(list));

const frozen = Object.freeze(sales.slice(0, 6)) as Sale[];
console.log(JSON.stringify(filterThenMap(frozen)), Object.isFrozen(filterThenMap(frozen)));
