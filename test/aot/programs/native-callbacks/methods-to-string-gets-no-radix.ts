// Methods found through instances: join, String, concat, Symbol, RegExp, parseInt and a property key all call toString without an argument, while every call in the program passes a number.
let total = 0;

class Amount {
  constructor(public cents: number) {}
  toString(radix: number): string {
    total += typeof radix === "number" ? 1 : radix === undefined ? 100 : 10000;
    return this.cents.toString(radix === undefined ? 10 : radix + 0);
  }
}

const amount: any = new Amount(255);
total += (amount as Amount).toString(16).length;
const texts: string[] = [
  [amount, amount].join("-"),
  String(amount),
  "".concat(amount),
  Symbol(amount).description!,
  new RegExp(amount).source,
  String(parseInt(amount)),
  Object.keys({ [amount]: 1 })[0],
  encodeURIComponent(amount),
  new Error(amount).message,
  "255".replace(amount, "x"),
  `${amount}`,
];
console.log(total, texts.join(""));
