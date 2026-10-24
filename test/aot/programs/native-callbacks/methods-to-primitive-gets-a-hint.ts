// Methods found through instances: every conversion calls Symbol.toPrimitive with one of three strings, while every call in the program passes a number.
let total = 0;

class Money {
  constructor(public cents: number) {}
  [Symbol.toPrimitive](digits: number): number | string {
    total += typeof digits === "number" ? 1 : digits === "number" ? 100 : digits === "string" ? 10000 : digits === "default" ? 1000000 : 100000000;
    return typeof digits === "number" ? this.cents.toFixed(digits) : (digits as string) === "string" ? "money" : this.cents;
  }
}

const money: any = new Money(5);
(money as Money)[Symbol.toPrimitive](2);
const results: unknown[] = [
  Math.abs(money),
  String(money),
  money + 1,
  `${money}`,
  new Date(money).getTime(),
  money == 5,
  money < 6,
  [1, 2, 3, 4, 5, 6].indexOf(6, money),
  ({ money: 1 } as any)[money],
  Number(money),
  BigInt(money),
  [money].join(),
  Object.is(Reflect.has({ money: 1 }, money), true),
];
console.log(total, results.join());
