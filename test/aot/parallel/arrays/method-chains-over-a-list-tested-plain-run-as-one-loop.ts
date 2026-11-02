// IR= 1 pricesOfEven NewArray(Like|WithCapacity)
// IR= 1 largeAmongPriced NewArray(Like|WithCapacity)
// IR= 0 totalOfEven NewArray(Like|WithCapacity)
// IR= 1 totalOfEven = GetArrayElement
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
function totalOfEven(list: Sale[]): number {
  return list
    .filter(o => o.amount % 2 === 0)
    .map(o => o.amount)
    .reduce((total, amount) => total + amount, 0);
}

let seen = 0;
for (let round = 0; round < 2000; round++) seen += pricesOfEven(sales).length + largeAmongPriced(sales).length + totalOfEven(sales);
console.log(seen);

const frozen = Object.freeze(sales.slice(0, 6)) as Sale[];
console.log(JSON.stringify(pricesOfEven(frozen)), JSON.stringify(largeAmongPriced(frozen)), totalOfEven(frozen));
console.log(Object.isFrozen(pricesOfEven(frozen)), Object.isFrozen(frozen));

const withHoles: Sale[] = new Array<Sale>(6);
withHoles[1] = sales[4]!;
withHoles[4] = sales[6]!;
console.log(JSON.stringify(pricesOfEven(withHoles)), JSON.stringify(largeAmongPriced(withHoles)), totalOfEven(withHoles));

const sealed = Object.seal(sales.slice(2, 5)) as Sale[];
console.log(JSON.stringify(pricesOfEven(sealed)), totalOfEven(sealed));

const withNull: Sale[] = [sales[2]!, null as unknown as Sale, sales[4]!];
for (const run of [pricesOfEven, largeAmongPriced, totalOfEven] as ((list: Sale[]) => unknown)[]) {
  try {
    console.log(JSON.stringify(run(withNull)));
  } catch (error) {
    console.log((error as Error).constructor.name, (error as Error).message);
  }
}

const empty: Sale[] = Object.freeze([]) as unknown as Sale[];
console.log(pricesOfEven(empty).length, largeAmongPriced(empty).length, totalOfEven(empty));
