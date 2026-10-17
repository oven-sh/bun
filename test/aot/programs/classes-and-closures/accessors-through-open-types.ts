// Getters and setters of classes, read and stored through a parameter whose class type also receives values of type `any`.
// The compiler may call the accessor directly for an object of the class. Every other object must behave as in plain JavaScript.
class Account {
  cents: number;
  reads = 0;
  constructor(cents: number) {
    this.cents = cents;
  }
  get dollars(): number {
    this.reads++;
    return this.cents / 100;
  }
  set dollars(value: number) {
    this.cents = value * 100;
  }
  get isEmpty(): boolean {
    return this.cents === 0;
  }
}

class Savings extends Account {
  get dollars(): number {
    return super.dollars + 1;
  }
  set dollars(value: number) {
    super.dollars = value - 1;
  }
}

class Frozen extends Account {}

function readDollars(a: Account): number {
  return a.dollars;
}

function readTwice(a: Account): number {
  return a.dollars + a.dollars;
}

function storeDollars(a: Account, value: number): void {
  a.dollars = value;
}

function isEmpty(a: Account | undefined): boolean | undefined {
  return a?.isEmpty;
}

function report(label: string, run: () => unknown): void {
  try {
    console.log(label + ":", String(run()));
  } catch (e) {
    console.log(label + ":", "throws", (e as Error).name);
  }
}

const anything = (value: unknown): any => value;

report("an object of the class", () => readDollars(new Account(150)));
report("through any", () => readDollars(anything(new Account(250))));
report("a subclass that overrides", () => readDollars(anything(new Savings(300))));
report("a subclass that inherits", () => readDollars(anything(new Frozen(400))));
report("a plain object with the property", () => readDollars(anything({ cents: 1, reads: 0, dollars: 7, isEmpty: false })));
report("a plain object with a getter", () => readDollars(anything({ cents: 1, reads: 0, get dollars() { return 8; }, isEmpty: false })));
report("an object that inherits from an instance", () => readDollars(anything(Object.create(new Account(500)))));
report("a proxy of an instance", () => {
  const seen: string[] = [];
  const proxy = new Proxy(new Account(600), { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } });
  return readDollars(anything(proxy)) + " " + seen.join();
});
report("null", () => readDollars(anything(null)));
report("undefined", () => readDollars(anything(undefined)));
report("the getter runs each time", () => {
  const a = new Account(100);
  return readTwice(anything(a)) + " reads " + a.reads;
});
report("a getter that throws", () => {
  class Broken extends Account {
    get dollars(): number {
      throw new RangeError("no");
    }
  }
  return readDollars(anything(new Broken(1)));
});
report("the setter", () => {
  const a = new Account(0);
  storeDollars(anything(a), 3);
  return a.cents;
});
report("the setter of a subclass", () => {
  const a = new Savings(0);
  storeDollars(anything(a), 3);
  return a.cents;
});
report("a store to a plain object", () => {
  const o = { cents: 1, reads: 0, dollars: 7, isEmpty: false };
  storeDollars(anything(o), 9);
  return o.dollars + " " + o.cents;
});
report("a store to a plain object with a setter", () => {
  let stored = 0;
  const o = { cents: 1, reads: 0, get dollars() { return stored; }, set dollars(v: number) { stored = v + 1; }, isEmpty: false };
  storeDollars(anything(o), 9);
  return stored;
});
report("a store to null", () => storeDollars(anything(null), 1));
report("optional chaining", () => [isEmpty(anything(new Account(0))), isEmpty(anything(new Account(1))), isEmpty(undefined), isEmpty(anything({ isEmpty: true }))].join());
for (let i = 0; i < 4; i++) report("mixed " + i, () => readDollars(anything(i % 2 ? { dollars: i } : new Account(i * 100))));
