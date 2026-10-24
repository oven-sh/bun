class Shelf {
  prices: number[];
  constructor(prices: number[]) {
    this.prices = prices;
  }
}

function total(shelf: Shelf): number {
  let sum = 0;
  for (let i = 0; i < shelf.prices.length; i++) sum += shelf.prices[i];
  return sum;
}

function totalWithOtherArray(shelf: Shelf, other: number[], at: number): number {
  let sum = 0;
  for (let i = 0; i < shelf.prices.length; i++) {
    if (i === at) shelf.prices = other;
    sum += shelf.prices[i];
  }
  return sum;
}

function totalWithText(shelf: Shelf, at: number): number {
  let sum = 0;
  for (let i = 0; i < shelf.prices.length; i++) {
    if (i === at) (shelf.prices as any[])[0] = "text";
    sum += shelf.prices[i];
  }
  return sum;
}

function totalWithPush(shelf: Shelf, at: number): number {
  let sum = 0;
  for (let i = 0; i < shelf.prices.length; i++) {
    if (i === at) shelf.prices.push(0.25, 0.5, 0.75, 1.25, 1.5, 1.75, 2.25, 2.5, 2.75);
    sum += shelf.prices[i];
  }
  return sum;
}

function totalWithShorterLength(shelf: Shelf, at: number): number {
  let sum = 0;
  for (let i = 0; i < shelf.prices.length; i++) {
    if (i === at) shelf.prices.length = at + 2;
    sum += shelf.prices[i];
  }
  return sum;
}

function totalWithFraction(shelf: Shelf, at: number): number {
  let sum = 0;
  for (let i = 0; i < shelf.prices.length; i++) {
    if (i === at) shelf.prices[i + 1] = 0.5;
    sum += shelf.prices[i];
  }
  return sum;
}

const integers = (): number[] => [1, 2, 3, 4, 5, 6, 7, 8];
const fractions = (): number[] => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
const few = (): number[] => [10.5, 20.5, 30.5];
const many = (): number[] => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
function withHole(): number[] {
  const list = fractions();
  delete (list as any)[3];
  return list;
}

const makers = [integers, fractions, few, many, withHole];
for (let round = 0; round < 3; round++) {
  for (const make of makers) {
    console.log("total", round, total(new Shelf(make())));
    for (const makeOther of makers) {
      for (const at of [0, 1, 2, 7, 100]) console.log("other array", at, totalWithOtherArray(new Shelf(make()), makeOther(), at));
    }
    for (const at of [1, 2, 7, 100]) {
      console.log("text", at, totalWithText(new Shelf(make()), at));
      console.log("push", at, totalWithPush(new Shelf(make()), at));
      console.log("shorter", at, totalWithShorterLength(new Shelf(make()), at));
      console.log("fraction", at, totalWithFraction(new Shelf(make()), at));
    }
  }
}

const kept = new Shelf(fractions());
let sumOfMany = 0;
for (let i = 0; i < 20000; i++) {
  if (i === 15000) kept.prices = integers();
  if (i === 17000) (kept.prices as any[])[2] = "x";
  const one: any = total(kept);
  sumOfMany += typeof one === "number" ? one : one.length;
}
console.log("many", sumOfMany);
