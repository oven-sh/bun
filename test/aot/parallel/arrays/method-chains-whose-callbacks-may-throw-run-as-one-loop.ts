// IR= 1 pricesOfEven NewArray(Like|WithCapacity)
// IR= 1 largeAmongPriced NewArray(Like|WithCapacity)
// IR= 1 namesOfOwners NewArray(Like|WithCapacity)
// IR= 1 totalOfOwners = GetArrayElement
// IR= 0 totalOfOwners NewArray(Like|WithCapacity)
// IR= 1 insideTry = GetArrayElement
// IR= 0 insideTry NewArray(Like|WithCapacity)
// IR= 0 counted = GetArrayElement
interface Owner {
  name: string;
  age: number;
}
interface Sale {
  customer: number;
  amount: number;
  owner: Owner | undefined;
}
interface Priced {
  customer: number;
  price: number;
}
const sales: Sale[] = [];
for (let i = 0; i < 12; i++) sales.push({ customer: i % 5, amount: i * 7, owner: { name: "owner " + i, age: 20 + i } });

function pricesOfEven(list: Sale[]): Priced[] {
  return list.filter(o => o.amount % 2 === 0).map(o => ({ customer: o.customer, price: o.amount + 1 }));
}
function largeAmongPriced(list: Sale[]): Priced[] {
  return list.map(o => ({ customer: o.customer, price: o.amount - 20 })).filter(p => p.price > 0);
}
function namesOfOwners(list: Sale[]): string[] {
  return list.filter(o => o.amount >= 0).map(o => o.owner!.name);
}
function checkedThenHalved(list: Sale[]): number[] {
  return list
    .map(o => {
      if (o.amount > 1000) throw new RangeError("too large: " + o.amount);
      return o.amount;
    })
    .map(x => {
      if (x < 0) throw new RangeError("below zero: " + x);
      return x / 2;
    });
}
function totalOfOwners(list: Sale[]): number {
  return list
    .filter(o => o.customer !== 3)
    .map(o => o.owner!.age)
    .reduce((total, age) => total + age, 0);
}
function insideTry(list: Sale[]): string {
  let said = "";
  try {
    said = list
      .filter(o => o.amount > 10)
      .map(o => o.owner!.age)
      .join();
  } catch (error) {
    said = "caught: " + (error as Error).message;
  } finally {
    said += ".";
  }
  return said;
}

function attempt(what: string, run: () => unknown): void {
  let said = "";
  try {
    said = JSON.stringify(run()) ?? "nothing";
  } catch (error) {
    said = (error as Error).constructor.name + ": " + (error as Error).message;
  }
  console.log(what + ":", said);
}

let lengths = 0;
for (let round = 0; round < 2000; round++) {
  lengths += pricesOfEven(sales).length + largeAmongPriced(sales).length + namesOfOwners(sales).length + checkedThenHalved(sales).length + totalOfOwners(sales) + insideTry(sales).length;
}
console.log(lengths);
attempt("every element is there", () => [pricesOfEven(sales), largeAmongPriced(sales), namesOfOwners(sales), checkedThenHalved(sales), totalOfOwners(sales), insideTry(sales)]);
attempt("no element", () => [pricesOfEven([]), largeAmongPriced([]), namesOfOwners([]), checkedThenHalved([]), totalOfOwners([]), insideTry([])]);

const nothing = null as unknown as Sale;
const absent = undefined as unknown as Sale;
const ownerless: Sale = { customer: 1, amount: 14, owner: undefined };
const tooLarge: Sale = { customer: 2, amount: 5000, owner: { name: "large", age: 1 } };
const belowZero: Sale = { customer: 2, amount: -4, owner: { name: "below", age: 2 } };

attempt("null in the middle", () => pricesOfEven([sales[2]!, nothing, sales[4]!]));
attempt("undefined at the end", () => pricesOfEven([sales[2]!, sales[4]!, absent]));
attempt("null at the start", () => largeAmongPriced([nothing, sales[4]!]));
attempt("undefined at the end, map in front", () => largeAmongPriced([sales[4]!, sales[6]!, absent]));

attempt("no owner first, null last", () => namesOfOwners([ownerless, sales[1]!, nothing]));
attempt("no owner first, undefined last", () => namesOfOwners([ownerless, absent]));
attempt("no owner alone", () => namesOfOwners([sales[1]!, ownerless, sales[2]!]));
attempt("below zero first, too large last", () => checkedThenHalved([belowZero, sales[1]!, tooLarge]));
attempt("too large first, below zero last", () => checkedThenHalved([tooLarge, sales[1]!, belowZero]));
attempt("below zero alone", () => checkedThenHalved([sales[1]!, belowZero]));
attempt("below zero first, null last", () => checkedThenHalved([belowZero, nothing]));
attempt("no owner first, null last, reduce", () => totalOfOwners([ownerless, sales[1]!, nothing]));
attempt("no owner is filtered out", () => totalOfOwners([{ customer: 3, amount: 1, owner: undefined }, sales[1]!]));
attempt("no owner first, null last, inside try", () => insideTry([ownerless, sales[2]!, nothing]));
attempt("no owner, inside try", () => insideTry([sales[2]!, ownerless]));

const withHoles: Sale[] = new Array<Sale>(6);
withHoles[1] = sales[4]!;
withHoles[4] = sales[6]!;
attempt("holes", () => [pricesOfEven(withHoles), Object.keys(largeAmongPriced(withHoles)), namesOfOwners(withHoles), Object.keys(checkedThenHalved(withHoles)), totalOfOwners(withHoles), insideTry(withHoles)]);
withHoles[5] = nothing;
withHoles[0] = ownerless;
attempt("holes, no owner first, null last", () => namesOfOwners(withHoles));

function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  return new Error("nothing was thrown");
}
const first = thrownBy(() => namesOfOwners([ownerless, nothing]));
const second = thrownBy(() => namesOfOwners([ownerless, nothing]));
console.log(first === second, first.message === second.message, first instanceof TypeError);
const named = /^(?:\s*at )?(filter|map|namesOfOwners)\b/;
const frames = (first.stack ?? "").split("\n").filter(line => named.test(line));
console.log(frames.map(line => named.exec(line)![1]).join(" < "));

let seen = 0;
function counted(list: Sale[]): number[] {
  return list
    .filter(o => {
      seen++;
      return o.amount >= 0;
    })
    .map(o => o.owner!.age);
}
attempt("the callback in front counts", () => counted([ownerless, sales[1]!, sales[2]!]));
console.log(seen);
