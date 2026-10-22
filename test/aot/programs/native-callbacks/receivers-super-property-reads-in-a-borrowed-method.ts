// Receivers below an accessor: `super.value` runs the getter of the base class with the `this` of the method, and the method is borrowed through call, Reflect.apply and a native callback's `this` argument.
let total = 0;

class Base {
  amount = 1;
  get value(): number {
    total += this instanceof Base ? 1 : 100;
    return this.amount * 2;
  }
  describe(): string {
    return "base " + typeof this.amount;
  }
}

class Derived extends Base {
  get value(): number {
    return super.value + 1;
  }
  read(): number {
    return super.value;
  }
  tell(): string {
    return super.describe();
  }
}

const derived = new Derived();
const results: unknown[] = [
  derived.value,
  derived.read(),
  derived.read.call({ amount: "3" } as any),
  Reflect.apply(derived.read, { amount: [4] }, []),
  [0].map(derived.read, { amount: "5" })[0],
  [0].map(derived.tell, "text")[0],
  Reflect.get(derived, "value", { amount: "6" }),
  derived.tell.call(7 as any),
];
console.log(total, results.join());
