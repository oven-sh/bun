// What a program can observe of the definition of a top-level class: the dead zone in front of it, the order of its static initializers, its own properties, subclasses made elsewhere.
const log: string[] = [];
function note(text: string): string {
  log.push(text);
  return text;
}
function tooEarly(): string {
  try {
    return new Later().name();
  } catch (error) {
    return (error as Error).name;
  }
}
console.log("before the definition:", tooEarly());
note("in front of Later");
class Later {
  static first = note("Later.first");
  static second = note("Later.second " + Later.first);
  static {
    note("Later's static block");
  }
  field = note("a field of an instance");
  name(): string {
    return "Later.name";
  }
  get twice(): string {
    return this.name() + this.name();
  }
  set twice(value: string) {
    note("set twice " + value);
  }
  static build(a: number, b: number): number {
    return a + b;
  }
  [Symbol.iterator](): Iterator<number> {
    return [1, 2][Symbol.iterator]();
  }
  constructor(public a = 1, public b = 2) {}
}
note("behind Later");
console.log("after the definition:", tooEarly(), log.join(", "));

function describe(object: object): string {
  return Reflect.ownKeys(object)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
      const kind = "value" in descriptor ? typeof descriptor.value : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
      return String(key) + ":" + flags + ":" + kind;
    })
    .join(" ");
}
console.log("the class object:", describe(Later));
console.log("the prototype object:", describe(Later.prototype));
console.log(Later.name, Later.length, typeof Later, Later.prototype.constructor === Later, Object.getPrototypeOf(Later) === Function.prototype, Object.getPrototypeOf(Later.prototype) === Object.prototype);
console.log(Later.build.name, Later.build.length, Later.prototype.name.name, Object.getOwnPropertyDescriptor(Later.prototype, "twice")!.get!.name, [...new Later()].join());
try {
  (Later as any)();
} catch (error) {
  console.log("called without new:", (error as Error).name);
}

class Child extends Later {
  name(): string {
    return "Child.name over " + super.name();
  }
}
console.log(Child.name, Child.length, Object.getPrototypeOf(Child) === Later, Object.getPrototypeOf(Child.prototype) === Later.prototype, new Child().name(), new Child().twice, Child.build(1, 2), Child.first);

function makeNested(tag: string) {
  return class Nested extends Later {
    name(): string {
      return tag + " over " + super.name();
    }
  };
}
const One = makeNested("one");
const Two = makeNested("two");
console.log(new One().name(), new Two().name(), One === Two, One.name, new One() instanceof Later, Object.getPrototypeOf(One) === Later);

const Wrapped = new Proxy(Later, {
  get(target, key, receiver) {
    if (key === "prototype") note("the proxy is asked for prototype");
    return Reflect.get(target, key, receiver);
  },
});
class BelowProxy extends (Wrapped as typeof Later) {
  name(): string {
    return "BelowProxy over " + super.name();
  }
}
console.log(new BelowProxy().name(), BelowProxy.build(2, 3), new BelowProxy() instanceof Later, log.filter(entry => entry.startsWith("the proxy")).length);

class NoParent extends (null as any) {
  static tell(): string {
    return "NoParent.tell";
  }
}
console.log(NoParent.tell(), Object.getPrototypeOf(NoParent.prototype), Object.getPrototypeOf(NoParent) === Function.prototype);

const Expression = class {
  tell(): string {
    return "an anonymous class expression";
  }
};
console.log(Expression.name, new Expression().tell());
console.log(log.length, log.slice(-3).join(", "));
