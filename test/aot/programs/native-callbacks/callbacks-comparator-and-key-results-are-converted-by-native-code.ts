// Callbacks handed over: what a callback returns is in native hands: sort converts it with valueOf, Object.groupBy and Object.fromEntries with toString, and flatMap spreads it; these methods get no argument, the program passes one.
let total = 0;

class Order {
  constructor(public rank: number) {}
  valueOf(bias: number): number {
    total += typeof bias === "number" ? 1 : bias === undefined ? 100 : 10000;
    return this.rank;
  }
  toString(prefix: string): string {
    total += typeof prefix === "string" ? 100000 : prefix === undefined ? 1000000 : 10000000;
    return "rank" + this.rank;
  }
}

const own = new Order(1);
own.valueOf(1);
own.toString("p");
const sorted = [3, 1, 2].sort((a, b) => new Order(a - b) as any);
const groups = Object.groupBy([1, 2, 3], value => new Order(value % 2) as any);
const entries = Object.fromEntries([[new Order(5) as any, 1]]);
const mapped = Map.groupBy([1, 2], value => new Order(value)).size;
console.log(total % 100000 > 100, Math.floor(total / 100000), sorted.join(), Object.keys(groups).join(), Object.keys(entries).join(), mapped);
