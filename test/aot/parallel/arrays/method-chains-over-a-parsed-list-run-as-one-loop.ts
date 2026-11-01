// IR= 1 pricesOfEven NewArray(Like|WithCapacity)
// IR= 1 largeAmongPriced NewArray(Like|WithCapacity)
// IR= 1 aboveLimit NewArray(Like|WithCapacity)
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
function aboveLimit(list: Sale[], limit: number): number[] {
  return list.filter(o => o.amount > limit).map(o => o.amount - limit);
}
function totalOfEven(list: Sale[]): number {
  return list
    .filter(o => o.amount % 2 === 0)
    .map(o => o.amount)
    .reduce((total, amount) => total + amount, 0);
}

let seen = 0;
for (let round = 0; round < 2000; round++) seen += pricesOfEven(sales).length + largeAmongPriced(sales).length + aboveLimit(sales, round & 15).length + totalOfEven(sales);
console.log(seen);

const parsed = JSON.parse(`[{"customer":1,"amount":4},{"customer":2,"amount":5},{"customer":3,"amount":40}]`) as Sale[];
console.log(JSON.stringify(pricesOfEven(parsed)), JSON.stringify(largeAmongPriced(parsed)), aboveLimit(parsed, 4).join(), totalOfEven(parsed));

const mixed = [sales[2]!, ...parsed, sales[4]!];
console.log(JSON.stringify(pricesOfEven(mixed)), JSON.stringify(largeAmongPriced(mixed)), aboveLimit(mixed, 4).join(), totalOfEven(mixed));

const strange = JSON.parse(`[{"customer":1,"amount":"4"},{"customer":2},{"amount":null},3,"text",null]`) as Sale[];
for (const run of [pricesOfEven, largeAmongPriced, totalOfEven] as ((list: Sale[]) => unknown)[]) {
  for (const list of [strange.slice(0, 3), strange.slice(0, 5), strange]) {
    try {
      console.log(JSON.stringify(run(list)));
    } catch (error) {
      console.log((error as Error).constructor.name, (error as Error).message);
    }
  }
}
