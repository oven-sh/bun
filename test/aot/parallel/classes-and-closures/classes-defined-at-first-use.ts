// A class at the top of a module is defined when something first needs it. Each family here is first needed in another way, and afterwards it must look as if its definition had run in its place.
// The uses stand in a function: a class that only the body of its own module reads needs no variable, so there is nothing to put off.
// STATISTIC: ClassesDeferredInVariables >= 20
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).name;
  }
}

function describe(object: object): string {
  return Reflect.ownKeys(object)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      const kind = "value" in descriptor ? typeof descriptor.value : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
      const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
      return String(key) + ":" + kind + ":" + flags;
    })
    .join(" ");
}

function look(name: string, Base: any, Derived: any): void {
  console.log(name);
  console.log("  " + describe(Base) + " | " + describe(Base.prototype));
  console.log("  " + describe(Derived) + " | " + describe(Derived.prototype));
  console.log("  names " + Base.name + " " + Derived.name + ", lengths " + Base.length + " " + Derived.length);
  console.log("  links " + (Object.getPrototypeOf(Derived) === Base) + " " + (Object.getPrototypeOf(Derived.prototype) === Base.prototype) + " " + (Object.getPrototypeOf(Base) === Function.prototype) + " " + (Object.getPrototypeOf(Base.prototype) === Object.prototype));
  console.log("  constructors " + (Base.prototype.constructor === Base) + " " + (Derived.prototype.constructor === Derived));
  const made = new Derived(2);
  console.log("  instance " + made.size() + " " + made.twice() + " " + made.label + " " + (made instanceof Base) + " " + (made instanceof Derived) + " " + Derived.create(3).size() + " " + Base.create(4).size());
  console.log("  same methods " + (made.size === Base.prototype.size) + " " + (made.twice === Derived.prototype.twice) + " " + (Derived.create === Base.create));
  console.log("  called " + attempt(() => Base()) + ", text " + String(Base).slice(0, 12));
}

class ByConstruction {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByConstruction extends ByConstruction {
  twice() { return this.n * 2; }
}

class BySubclassConstruction {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowBySubclassConstruction extends BySubclassConstruction {
  twice() { return this.n * 2; }
}

class ByStaticCall {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByStaticCall extends ByStaticCall {
  twice() { return this.n * 2; }
}

class ByInheritedStaticCall {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByInheritedStaticCall extends ByInheritedStaticCall {
  twice() { return this.n * 2; }
}

class ByInstanceTest {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByInstanceTest extends ByInstanceTest {
  twice() { return this.n * 2; }
}

class ByValue {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByValue extends ByValue {
  twice() { return this.n * 2; }
}

class ByPrototypeRead {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByPrototypeRead extends ByPrototypeRead {
  twice() { return this.n * 2; }
}

class ByPrototypeStore {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByPrototypeStore extends ByPrototypeStore {
  twice() { return this.n * 2; }
}

class ByReparenting {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new this(n); }
}
class BelowByReparenting extends ByReparenting {
  twice() { return this.n * 2; }
}

class ByOwnName {
  constructor(public n: number) {}
  size() { return this.n; }
  get label() { return "n" + this.n; }
  static create(n: number) { return new ByOwnName(n); }
  static self() { return ByOwnName; }
}
class BelowByOwnName extends ByOwnName {
  twice() { return this.n * 2; }
}

class NeverUsed {
  unused() { return 1; }
}
class BelowNeverUsed extends NeverUsed {}

function run(): void {
  const hidden: any = (value: unknown) => value;

  console.log("construction " + new ByConstruction(1).size());
  look("ByConstruction", ByConstruction, BelowByConstruction);

  console.log("construction below " + new BelowBySubclassConstruction(1).twice());
  look("BySubclassConstruction", BySubclassConstruction, BelowBySubclassConstruction);

  console.log("static call " + ByStaticCall.create(5).label);
  look("ByStaticCall", ByStaticCall, BelowByStaticCall);

  console.log("inherited static call " + (BelowByInheritedStaticCall.create(5) as BelowByInheritedStaticCall).twice());
  look("ByInheritedStaticCall", ByInheritedStaticCall, BelowByInheritedStaticCall);

  console.log("instance test " + (hidden({}) instanceof BelowByInstanceTest) + " " + (hidden(null) instanceof ByInstanceTest));
  look("ByInstanceTest", ByInstanceTest, BelowByInstanceTest);

  console.log("value " + typeof hidden(BelowByValue) + " " + (hidden(BelowByValue) === BelowByValue));
  look("ByValue", ByValue, BelowByValue);

  console.log("prototype read " + typeof BelowByPrototypeRead.prototype.twice + " " + Object.keys(ByPrototypeRead.prototype).length);
  look("ByPrototypeRead", ByPrototypeRead, BelowByPrototypeRead);

  hidden(ByPrototypeStore.prototype).size = function (this: ByPrototypeStore) { return this.n + 100; };
  hidden(BelowByPrototypeStore).extra = 1;
  look("ByPrototypeStore", ByPrototypeStore, BelowByPrototypeStore);

  const otherParent = { size() { return -1; }, added: true };
  Object.setPrototypeOf(BelowByReparenting.prototype, otherParent);
  console.log("reparented " + new BelowByReparenting(1).size() + " " + (new BelowByReparenting(1) instanceof ByReparenting));
  Object.setPrototypeOf(BelowByReparenting.prototype, ByReparenting.prototype);
  look("ByReparenting", ByReparenting, BelowByReparenting);

  console.log("own name " + (ByOwnName.self() === ByOwnName) + " " + (BelowByOwnName.self() === ByOwnName));
  look("ByOwnName", ByOwnName, BelowByOwnName);
}
run();
