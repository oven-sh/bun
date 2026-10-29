function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Money {
  amount: number;
  currency = "USD";
  constructor(amount: number) {
    this.amount = amount;
    Object.freeze(this);
  }
  add(n: number): this {
    this.amount += n;
    return this;
  }
  plus(n: number): Money {
    return new Money(this.amount + n);
  }
}

attempt("a frozen instance is read", () => new Money(1).amount);
attempt("its own method stores", () => new Money(1).add(2).amount);
attempt("its own method makes another", () => new Money(1).plus(2).amount);

class Tip extends Money {
  percent = 10;
}
attempt("a subclass adds a field to a frozen this", () => new Tip(1).percent);

class Plain extends Money {
  describe(): string {
    return this.amount + this.currency;
  }
}
attempt("a subclass without fields", () => new Plain(3).describe());

class Sealed {
  a = 1;
  b?: number;
  constructor() {
    Object.seal(this);
  }
}
attempt("sealed, a declared optional field", () => {
  const s = new Sealed();
  s.b = 2;
  return JSON.stringify(s) + " " + Object.keys(s).join();
});
attempt("sealed, deleting it", () => {
  const s = new Sealed();
  return delete s.b;
});

class Early {
  first = 1;
  second: number;
  constructor() {
    Object.preventExtensions(this);
    this.second = 2;
  }
}
attempt("not extensible before the constructor's store", () => JSON.stringify(new Early()));

class FreezesInAField {
  a = 1;
  lock = Object.freeze(this);
  b = 2;
}
attempt("frozen by a field initializer", () => JSON.stringify(Object.keys(new FreezesInAField())));

class Sometimes {
  value = 0;
  constructor(freeze: boolean) {
    if (freeze) Object.freeze(this);
  }
  set(v: number): number {
    this.value = v;
    return this.value;
  }
}

const open = new Sometimes(false);
for (let i = 0; i < 2000; i++) open.set(i);
console.log("2000 honest: " + open.value);
attempt("then a frozen instance of the same class", () => new Sometimes(true).set(1));
attempt("then the open one", () => open.set(1));

const both: Sometimes[] = [new Sometimes(false), new Sometimes(true), new Sometimes(false)];
attempt("elements", () => both.map(s => s.set(5)).join());
console.log("they hold: " + both.map(s => s.value).join());

class Registry {
  static entries: Record<string, number> = Object.freeze({ a: 1 });
  static count = 0;
}
attempt("a frozen static record", () => (Registry.entries.b = 2));
Object.freeze(Registry);
attempt("a frozen class, a static store", () => ++Registry.count);
attempt("a frozen class still constructs", () => new Registry() instanceof Registry);

Object.freeze(Sometimes.prototype);
attempt("a frozen prototype, a method replaced", () => {
  Sometimes.prototype.set = () => -1;
  return "replaced";
});
attempt("a frozen prototype, an own member of that name", () => {
  const s = new Sometimes(false);
  s.set = () => -2;
  return s.set(0);
});
attempt("a frozen prototype, fields still work", () => new Sometimes(false).set(3));

export {};
