// The compiler options say that fields are assigned and that decorators are the experimental ones. Classes with parameter properties and a field under a symbol have a decorator on a field, a method, a parameter or the class; their prototypes get setters, then read-only properties, under every name.
const mark = Symbol("mark");
const names: (string | symbol)[] = ["x", "w", "y", "z", mark];
let log: string[] = [];

function note(...given: unknown[]): void {
  log.push("decorator with " + given.length);
}

function describe(make: () => object): string {
  log = [];
  let made: string;
  try {
    const object = make();
    made = Reflect.ownKeys(object)
      .map(name => String(name) + "=" + String(Reflect.get(object, name)))
      .join(", ");
  } catch (error) {
    made = (error as Error).name + ": " + (error as Error).message;
  }
  return "[" + log.join("; ") + "] {" + made + "}";
}

function tell(label: string, prototype: object, make: () => object): void {
  console.log(label, "as written", describe(make));
  for (const name of names) {
    Object.defineProperty(prototype, name, {
      set(value: unknown) {
        log.push("set " + String(name) + " to " + String(value));
      },
      configurable: true,
    });
  }
  console.log(label, "setters", describe(make));
  for (const name of names) {
    Object.defineProperty(prototype, name, { value: "fixed", writable: false, configurable: true });
  }
  console.log(label, "read-only", describe(make));
}

class Parent {
  constructor() {
    log.push("parent");
  }
}

{
  class Made {
    @note y = 1;
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("field", Made.prototype, () => new Made(1));
}
{
  class Made {
    @note [mark] = 2;
    constructor(public x: number) {}
  }
  tell("field under the symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    @note method() {}
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("method", Made.prototype, () => new Made(1));
}
{
  class Made {
    @note static y = 1;
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("static field", Made.prototype, () => new Made(1));
}
{
  class Made {
    [mark] = 2;
    constructor(@note public x: number) {}
  }
  tell("parameter property", Made.prototype, () => new Made(1));
}
{
  @note
  class Made {
    [mark] = 2;
    constructor(public x: number) {}
  }
  tell("class", Made.prototype, () => new Made(1));
}
{
  class Made extends Parent {
    @note y = 1;
    [mark] = 2;
    z = 3;
    constructor(
      public x: number,
      public w: number = 2,
    ) {
      log.push("before super");
      super();
      log.push("behind super");
    }
  }
  tell("field of a derived class", Made.prototype, () => new Made(1));
}
