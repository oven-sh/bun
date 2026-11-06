import { Hidden } from "./hidden";
const key = "computed";
const order: string[] = [];
const noted = <T>(name: string, value: T) => (order.push(name), value);
class Counter {
  before = noted("before", 1);
  accessor count = noted("count", 0);
  after = noted("after", 2);
  static accessor made = 0;
  accessor [key] = "by a computed key";
  constructor() {
    Counter.made++;
  }
}
class Named extends Counter {
  accessor name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
  override get count() {
    return super.count + 100;
  }
  override set count(value: number) {
    super.count = value * 2;
  }
}
const counter = new Counter();
counter.count += 5;
console.log(counter.count, Counter.made, counter[key], order.join());
console.log(
  Object.keys(counter).join(),
  Object.getOwnPropertyNames(Counter.prototype).join(),
  Object.getOwnPropertyNames(Counter).includes("made"),
);
const described = Object.getOwnPropertyDescriptor(Counter.prototype, "count")!;
console.log(typeof described.get, typeof described.set, described.enumerable, described.configurable);
const named = new Named("first");
named.count = 4;
console.log(named.name, named.count, Counter.made, Object.keys(named).join());
try {
  described.get!.call({});
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(new Hidden().double());
