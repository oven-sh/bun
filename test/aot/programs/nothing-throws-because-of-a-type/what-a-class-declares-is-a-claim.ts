// What a class declares about its fields is a claim too: fields that are declared and never stored, `declare` fields, read-only and private-by-keyword fields, optional fields, objects that only look like
// instances, and classes whose prototype or whose methods are changed behind the compiler's back.
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (value instanceof Map) return "Map(" + describe([...value]) + ")";
  if (value instanceof Set) return "Set(" + describe([...value]) + ")";
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).map(key => key + ": " + describe(record[key])).join(", ") + "}";
  }
  return Object.is(value, -0) ? "-0" : String(value);
}
// An error of the language (a member of null, a call of what is no function) is thrown by plain Bun too: its class is printed, not its text.
function say(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = describe(run());
  } catch (error) {
    line = "THREW " + (error as Error).constructor.name;
  }
  console.log(label + ": " + line);
}
// What nobody can know at build time.
const outside: any = JSON.parse(`{"text": "t", "number": 5, "nothing": null, "list": [1, "two", null], "record": {"x": "s"}, "yes": true}`);

class Late1 {
  value!: number;
  name!: string;
}
say("a field with a definite-assignment mark that nobody stores", () => {
  const late = new Late1();
  return [typeof late.value, late.value + 1, "value" in late, late.name + "!"];
});
say("such a field, its member read", () => new Late1().name.length);
class Declared2 {
  declare value: number;
}
say("a field that is only declared", () => {
  const declared = new Declared2();
  return [typeof declared.value, "value" in declared, Object.keys(declared).length];
});
class Fixed3 {
  readonly value: number = 1;
}
say("a store to a read-only field through a cast", () => {
  const fixed = new Fixed3();
  (fixed as { value: number }).value = 2;
  (fixed as any).value += "!";
  return [typeof fixed.value, fixed.value];
});
class Hidden4 {
  private secret: number = 1;
  reveal(): number {
    return this.secret + 1;
  }
}
say("a store to a field that is private by keyword", () => {
  const hidden = new Hidden4();
  (hidden as any).secret = "s";
  return [hidden.reveal(), Object.keys(hidden).join()];
});
class Optional5 {
  maybe?: number;
  sure: number = 1;
}
say("an optional field gets another kind, a required one undefined", () => {
  const optional = new Optional5();
  (optional as any).maybe = "m";
  (optional as any).sure = undefined;
  return [typeof optional.maybe, optional.maybe! + 1, typeof optional.sure, optional.sure + 1];
});
class Real6 {
  x: number = 1;
  twice(): number {
    return this.x * 2;
  }
}
say("an object made below the prototype of a class, without its fields", () => {
  const fake: Real6 = Object.create(Real6.prototype);
  return [fake instanceof Real6, typeof fake.x, fake.twice(), "x" in fake];
});
say("a literal with the prototype of a class and a field of another kind", () => {
  const fake = { __proto__: Real6.prototype, x: "s" } as unknown as Real6;
  return [fake instanceof Real6, fake.twice(), fake.x + 1];
});
class Real7 {
  x: number = 1;
  twice(): number {
    return this.x * 2;
  }
}
say("an instance loses its prototype", () => {
  const real = new Real7();
  Object.setPrototypeOf(real, null);
  return [typeof real.twice, real.x + 1, real instanceof Real7];
});
say("an instance without its prototype, its method called", () => {
  const real = new Real7();
  Object.setPrototypeOf(real, null);
  return real.twice();
});
class Real8 {
  x: number = 1;
  twice(): number {
    return this.x * 2;
  }
}
say("a method is replaced by one that answers another kind", () => {
  const real = new Real8();
  const before = real.twice();
  (Real8.prototype as any).twice = () => "replaced";
  const after = real.twice();
  return [before, typeof after, after + 1];
});
class Real9 {
  x: number = 1;
  twice(): number {
    return this.x * 2;
  }
}
say("a method is replaced by what is no function", () => {
  const real = new Real9();
  (Real9.prototype as any).twice = 5;
  return typeof real.twice;
});
say("what is no function is called as the method", () => new Real9().twice());
class Real10 {
  x: number = 1;
}
say("the name of a field is defined on the prototype", () => {
  Object.defineProperty(Real10.prototype, "x", { get: () => "from above", set() {}, configurable: true });
  const real = new Real10();
  delete (real as any).x;
  return [typeof real.x, real.x + 1, "x" in real, Object.keys(real).length];
});
class Real11 {
  x: number = 1;
}
say("an instance gets more properties than its class declares", () => {
  const real = new Real11();
  for (let index = 0; index < 40; index++) (real as any)["extra" + index] = index;
  return [Object.keys(real).length, real.x, (real as any).extra39];
});
class Real12 {
  x: number = 1;
  y: number = 2;
}
say("sealed, frozen and not extensible instances are read", () => {
  const sealed = Object.seal(new Real12());
  const frozen = Object.freeze(new Real12());
  const closed = Object.preventExtensions(new Real12());
  sealed.x = 5;
  return [sealed.x + sealed.y, frozen.x + frozen.y, closed.x + closed.y];
});
say("a store to a frozen instance", () => {
  const frozen = Object.freeze(new Real12());
  (frozen as Real12).x = 5;
  return frozen.x;
});
class Parent13 {
  x: number = 1;
}
class Child13 extends Parent13 {
  y: number = 2;
}
say("the class above is changed", () => {
  Object.setPrototypeOf(Child13.prototype, { inherited: "i" });
  const child = new Child13();
  return [child.x + child.y, child instanceof Parent13, (child as any).inherited];
});
class Returns14 {
  x: number = 1;
  constructor(other?: object) {
    if (other) return other as Returns14;
  }
}
say("a constructor returns another object", () => {
  const made = new Returns14({ x: "other" });
  return [typeof made.x, made.x + 1, made instanceof Returns14];
});
class Static15 {
  static count: number = 0;
  static bump(): number {
    return ++Static15.count;
  }
}
say("a static field gets another kind", () => {
  (Static15 as any).count = "c";
  return [typeof Static15.count, Static15.bump(), typeof Static15.count];
});
interface Proxied16 {
  x: number;
  name: string;
}
say("a proxy as a typed object", () => {
  const proxied = new Proxy({}, { get: (_, key) => (key === "x" ? "from the trap" : 7), has: () => false }) as Proxied16;
  return [typeof proxied.x, proxied.x + 1, typeof proxied.name, "x" in proxied];
});

say("in a loop: the 397th instance has lost a field", () => {
  class Point {
    x: number = 1;
  }
  let total = 0;
  for (let round = 0; round < 400; round++) {
    const point = new Point();
    if (round === 396) delete (point as any).x;
    total += point.x;
  }
  return total;
});
say("in a loop: a method is replaced in the 397th round", () => {
  class Point {
    x: number = 1;
    get(): number {
      return this.x;
    }
  }
  const point = new Point();
  let total = 0;
  for (let round = 0; round < 400; round++) {
    if (round === 396) (Point.prototype as any).get = () => "r";
    total += point.get();
  }
  return total;
});
say("in a loop: the 397th instance was made below the prototype", () => {
  class Point {
    x: number = 1;
    get(): number {
      return this.x;
    }
  }
  let total = 0;
  for (let round = 0; round < 400; round++) {
    const point: Point = round === 396 ? Object.create(Point.prototype) : new Point();
    total += point.get();
  }
  return total;
});
