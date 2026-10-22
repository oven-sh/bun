// `+=`, `++`, `--`, `??=`, `||=`, `&&=`, `**=` and `delete` on an optional field whose slot is empty.
// They read through the prototype and store into the instance: first nothing is inherited, then a number, then zero, then undefined, then a getter with a setter.
// In this twin the class declares only what its constructor stores: the other fields are added late, through a cast to an interface.
const log: string[] = [];
interface CounterShape {
  id: number;
  n?: number;
}
class Counter {
  declare id: number;
  constructor(id: number) {
    this.id = id;
  }
}
const forms: [string, (counter: CounterShape) => unknown][] = [
  ["+=", counter => (counter.n! += 1)],
  ["post ++", counter => counter.n!++],
  ["pre --", counter => --counter.n!],
  ["??=", counter => (counter.n ??= 5)],
  ["||=", counter => (counter.n ||= 6)],
  ["&&=", counter => (counter.n &&= 7)],
  ["**=", counter => (counter.n! **= 2)],
  ["delete", counter => delete counter.n],
];
function add(counter: CounterShape) {
  counter.n! += 1;
  return counter.n;
}
function bump(counter: CounterShape) {
  return counter.n!++;
}
function orFive(counter: CounterShape) {
  return (counter.n ??= 5);
}
function round(title: string) {
  const parts: string[] = [];
  for (const [name, run] of forms) {
    const counter = new Counter(1) as CounterShape;
    const result = run(counter);
    parts.push(`${name}: ${result} ${counter.n} ${Object.hasOwn(counter, "n")}`);
  }
  const a = new Counter(2) as CounterShape;
  const b = new Counter(3) as CounterShape;
  const c = new Counter(4) as CounterShape;
  parts.push(`typed: ${add(a)} ${bump(b)} ${b.n} ${orFive(c)} [${Object.keys(a)}] [${Object.keys(b)}] [${Object.keys(c)}]`);
  console.log(title + " -> " + parts.join("; ") + (log.length ? " | " + log.join(", ") : ""));
  log.length = 0;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const counter = new Counter(i) as CounterShape;
  sum += orFive(counter) + bump(counter) + add(counter)!;
}
console.log("warm", sum);
const holder: any = Reflect.getPrototypeOf((new Counter(0) as CounterShape));
round("nothing inherited");
holder.n = 40;
round("40 inherited");
holder.n = 0;
round("0 inherited");
holder.n = undefined;
round("undefined inherited");
Object.defineProperty(holder, "n", {
  get(this: CounterShape) {
    log.push("get");
    return 9;
  },
  set(this: CounterShape, value: number) {
    log.push("set " + value);
  },
  configurable: true,
});
round("accessors inherited");
delete holder.n;
round("nothing inherited again");
