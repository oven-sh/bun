// The compiler options say that fields are assigned. Classes with parameter properties have fields under symbols and enum members; their prototypes get setters, then read-only properties, under every name.
const mark = Symbol("mark");
enum Numbers {
  one = 21,
}
enum Texts {
  one = "enum text",
}
const enum InlinedTexts {
  one = "inlined text",
}
const names: (string | symbol)[] = ["x", "w", "y", "z", mark, "21", "enum text", "inlined text", "literal", "7", Symbol.toStringTag];
let log: string[] = [];

function describe(make: () => object): string {
  log = [];
  let made: string;
  try {
    const object = make();
    const keys = Reflect.ownKeys(object).map(name => {
      const property = Object.getOwnPropertyDescriptor(object, name)!;
      const flags = (property.writable ? "w" : "-") + (property.enumerable ? "e" : "-") + (property.configurable ? "c" : "-");
      return String(name) + "=" + String(property.value) + " " + flags;
    });
    made = keys.join(", ");
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
    [mark] = 1;
    constructor(public x: number) {
      log.push("body");
    }
  }
  tell("symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    [mark]: number | undefined;
    constructor(private readonly x: number) {}
  }
  tell("symbol without a value", Made.prototype, () => new Made(1));
}
{
  class Made {
    y = 1;
    [mark] = 2;
    z = 3;
    constructor(
      public x: number,
      protected w: number = x + 1,
    ) {}
  }
  tell("names round a symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    y = (this as any).x;
    [mark] = (this as any).x;
    constructor(public x: number = 5) {}
  }
  tell("fields that read the parameter property", Made.prototype, () => new Made());
}
{
  class Made {
    [Numbers.one] = 1;
    [Texts.one] = 2;
    [InlinedTexts.one] = 3;
    constructor(public x: number) {}
  }
  tell("enum members", Made.prototype, () => new Made(1));
}
{
  class Made {
    ["literal"] = 1;
    [7] = 2;
    constructor(public x: number) {}
  }
  tell("literals in brackets", Made.prototype, () => new Made(1));
}
{
  class Made {
    [Symbol.toStringTag] = "tag";
    constructor(public x?: number) {}
  }
  tell("well-known symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    #hidden = 1;
    [mark] = this.#hidden;
    constructor(public x: number) {}
  }
  tell("private field beside a symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    static [mark] = 1;
    y = 2;
    constructor(public x: number) {}
  }
  tell("static symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    declare [mark]: number;
    y = 2;
    constructor(public x: number) {}
  }
  tell("declared symbol", Made.prototype, () => new Made(1));
}
{
  class Made {
    [mark]() {
      return 1;
    }
    y = 2;
    constructor(public x: number) {}
  }
  tell("method under a symbol", Made.prototype, () => new Made(1));
}
{
  class Made extends Parent {
    y = 1;
    [mark] = 2;
    constructor(public x: number) {
      super();
      log.push("behind super");
    }
  }
  tell("derived", Made.prototype, () => new Made(1));
}
{
  class Made extends Parent {
    [mark] = 2;
    constructor(
      first: number,
      public x: number = first,
    ) {
      log.push("before super");
      super();
      log.push("behind super");
    }
  }
  tell("derived, super is the second statement", Made.prototype, () => new Made(1));
}
{
  class Above {}
  class Made extends Above {
    [mark] = 2;
    constructor(public x: number) {
      super();
    }
  }
  tell("derived, the prototype of the parent changes", Above.prototype, () => new Made(1));
}
{
  const Made = class {
    [mark] = 1;
    constructor(public x: number) {}
  };
  tell("class expression", Made.prototype, () => new Made(1));
}
