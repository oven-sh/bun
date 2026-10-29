// The constructor of the base class calls a method on the object before the class below has defined its fields. The method does nothing, or it adds, deletes,
// fixes or reads properties, closes the object, keeps it, throws, or is overridden further down. Each object is shown as whoever kept it finds it.
const kept: object[] = [];

function describe(object: any): string {
  const values = ["id", "first", "second", "third", "last"].map(name => `${name in object ? "" : "no "}${String(object[name])}`);
  return `${Object.keys(object).join()} | ${values.join()} | ${JSON.stringify(object)} | ${Object.isExtensible(object)}`;
}

function show(label: string, make: () => object): void {
  const before = kept.length;
  let outcome = "made";
  let made: object | undefined;
  try {
    made = make();
  } catch (error) {
    outcome = `${(error as Error).constructor.name}: ${(error as Error).message}`;
  }
  console.log(label, outcome);
  if (made !== undefined) console.log("  made", describe(made));
  for (let index = before; index < kept.length; index++) console.log("  kept", describe(kept[index]), kept[index] === made);
}

class Base {
  id: number;
  constructor(id: number) {
    this.id = id;
    this.start();
  }
  start(): void {}
}

class Quiet extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
}

class Keeps extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
  }
}

class Adds extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    (this as any).extra = "added";
  }
}

class Deletes extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    delete (this as any).id;
  }
}

class Freezes extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    Object.freeze(this);
  }
}

class Seals extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    Object.seal(this);
  }
}

class StoresThenCloses extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    this.first = 50;
    this.second = 60;
    Reflect.preventExtensions(this);
  }
}

class FixesSecond extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    Object.defineProperty(this, "second", { value: 5, writable: true, enumerable: true, configurable: false });
  }
}

class FixesLast extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    Reflect.defineProperty(this, "last", { value: 5 });
  }
}

class FixesThirdAsAccessor extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    Object.defineProperties(this, {
      third: {
        get() {
          return "from the accessor";
        },
      },
    });
  }
}

class DefinesLooseAccessor extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    Object.defineProperty(this, "second", {
      get() {
        return "from the accessor";
      },
      configurable: true,
    });
  }
}

const actions: Record<string, (object: object) => void> = {
  nothing() {},
  close(object) {
    Object.preventExtensions(object);
  },
};

class ClosedByAnActionUnderAKey extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    actions[this.id % 2 ? "close" : "nothing"](this);
  }
}

const seen: string[] = [];

class ReadsEarly extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    seen.push(`${this.first},${this.last},${"first" in this},${"last" in this},${Object.keys(this).join()}`);
  }
}

class StoresEarly extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    this.last = 70;
    this.third = 90;
  }
}

class StoresEarlyAndLooks extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    seen.push(describe(this));
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    this.last = 70;
    this.third = 90;
  }
}

class Throws extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    throw new RangeError("thrown by the method");
  }
}

function refuse(n: number): number {
  if (n >= 0) throw new RangeError("thrown between the stores");
  return n;
}

class ThrowsBetweenTheStores extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.third = refuse(n);
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
  }
}

const probe = {
  valueOf(): number {
    seen.push(describe(kept[kept.length - 1]));
    return 8;
  },
};

class IsLookedAtBetweenTheStores extends Base {
  first: number;
  second: number;
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = Number(probe);
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
  }
}

class Middle extends Base {
  first: number;
  second: number;
  constructor(n: number) {
    super(n);
    this.first = n;
    this.second = n + 1;
    this.finish();
  }
  finish(): void {}
}

class BelowMiddle extends Middle {
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.third = n + 2;
    this.last = n + 3;
  }
}

class ClosesBelowMiddle extends Middle {
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.third = n + 2;
    this.last = n + 3;
  }
  finish(): void {
    kept.push(this);
    (this as any).third = 30;
    Object.preventExtensions(this);
  }
}

class ClosesAboveMiddle extends Middle {
  third: number;
  last: number;
  constructor(n: number) {
    super(n);
    this.third = n + 2;
    this.last = n + 3;
  }
  start(): void {
    kept.push(this);
    this.first = 10;
    Object.preventExtensions(this);
  }
}

class Texts extends Base {
  first: string;
  second: boolean;
  third: number[];
  last: Base | null;
  constructor(n: number) {
    super(n);
    this.first = `text ${n}`;
    this.second = n > 0;
    this.third = [n];
    this.last = null;
  }
  start(): void {
    kept.push(this);
    if (this.id === 2) Object.defineProperty(this, "last", { value: "fixed" });
  }
}

for (let n = 0; n < 3; n++) {
  show("quiet", () => new Quiet(n));
  show("keeps", () => new Keeps(n));
  show("adds", () => new Adds(n));
  show("deletes", () => new Deletes(n));
  show("freezes", () => new Freezes(n));
  show("seals", () => new Seals(n));
  show("stores, then closes", () => new StoresThenCloses(n));
  show("fixes the second", () => new FixesSecond(n));
  show("fixes the last", () => new FixesLast(n));
  show("fixes the third as an accessor", () => new FixesThirdAsAccessor(n));
  show("defines a loose accessor", () => new DefinesLooseAccessor(n));
  show("closed by an action under a key", () => new ClosedByAnActionUnderAKey(n));
  show("reads early", () => new ReadsEarly(n));
  show("stores early", () => new StoresEarly(n));
  show("stores early and looks", () => new StoresEarlyAndLooks(n));
  show("throws", () => new Throws(n));
  show("throws between the stores", () => new ThrowsBetweenTheStores(n));
  show("is looked at between the stores", () => new IsLookedAtBetweenTheStores(n));
  show("below the middle", () => new BelowMiddle(n));
  show("closes below the middle", () => new ClosesBelowMiddle(n));
  show("closes above the middle", () => new ClosesAboveMiddle(n));
  show("texts", () => new Texts(n));
}
console.log(seen.join("\n"));
