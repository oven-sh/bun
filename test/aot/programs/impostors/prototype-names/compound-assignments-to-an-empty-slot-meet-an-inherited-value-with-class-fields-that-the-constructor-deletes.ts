// `+=`, `++`, `--`, `??=`, `||=`, `&&=`, `**=` and `delete` on an optional field whose slot is empty.
// They read through the prototype and store into the instance: first nothing is inherited, then a number, then zero, then undefined, then a getter with a setter.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
class Counter {
  declare id: number;
  n?: number;
  constructor(id: number) {
    delete this.n;
    handOver(this);
    this.id = id;
  }
}
const forms: [string, (counter: Counter) => unknown][] = [
  ["+=", counter => (counter.n! += 1)],
  ["post ++", counter => counter.n!++],
  ["pre --", counter => --counter.n!],
  ["??=", counter => (counter.n ??= 5)],
  ["||=", counter => (counter.n ||= 6)],
  ["&&=", counter => (counter.n &&= 7)],
  ["**=", counter => (counter.n! **= 2)],
  ["delete", counter => delete counter.n],
];
function add(counter: Counter) {
  counter.n! += 1;
  return counter.n;
}
function bump(counter: Counter) {
  return counter.n!++;
}
function orFive(counter: Counter) {
  return (counter.n ??= 5);
}
function round(title: string) {
  const parts: string[] = [];
  for (const [name, run] of forms) {
    const counter = new Counter(1);
    const result = run(counter);
    parts.push(`${name}: ${result} ${counter.n} ${Object.hasOwn(counter, "n")}`);
  }
  const a = new Counter(2);
  const b = new Counter(3);
  const c = new Counter(4);
  parts.push(`typed: ${add(a)} ${bump(b)} ${b.n} ${orFive(c)} [${Object.keys(a)}] [${Object.keys(b)}] [${Object.keys(c)}]`);
  console.log(title + " -> " + parts.join("; ") + (log.length ? " | " + log.join(", ") : ""));
  log.length = 0;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const counter = new Counter(i);
  sum += orFive(counter) + bump(counter) + add(counter)!;
}
console.log("warm", sum);
const holder: any = Reflect.getPrototypeOf(new Counter(0));
round("nothing inherited");
holder.n = 40;
round("40 inherited");
holder.n = 0;
round("0 inherited");
holder.n = undefined;
round("undefined inherited");
Object.defineProperty(holder, "n", {
  get(this: Counter) {
    log.push("get");
    return 9;
  },
  set(this: Counter, value: number) {
    log.push("set " + value);
  },
  configurable: true,
});
round("accessors inherited");
delete holder.n;
round("nothing inherited again");
