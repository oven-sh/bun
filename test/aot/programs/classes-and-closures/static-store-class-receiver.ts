// A store that looks the key up on another object and has a class as its receiver (`super.x = v` in a static method, `Reflect.set(other, key, v, Class)`) changes the static field of the class or gives the class an own property, and compiled reads, calls and native lookups all see it.
function attempt(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function lookUp(target: object, key: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  const own = !descriptor ? "absent" : "value" in descriptor ? String(descriptor.value) : "accessor";
  return `[get ${String(Reflect.get(target, key))}, own ${own}, keys ${Object.keys(target).join("+")}]`;
}

class A {
  declare static x: number;
}
class B extends A {
  static x = 1;
  static y = 10;
  static m(): void {
    super.x = 2;
  }
  static store(value: number): void {
    super.x = value;
  }
  static read(): number {
    return B.x;
  }
}
console.log("initial:", B.x, B.read(), lookUp(B, "x"));
B.m();
console.log("super.x = 2:", B.x, B.read(), lookUp(B, "x"), Object.hasOwn(A, "x"));
console.log("Reflect.set:", Reflect.set({}, "x", 3, B), B.x, B.read(), lookUp(B, "x"));
B.x = 4;
console.log("B.x = 4:", B.x, B.read(), lookUp(B, "x"));
B.m();
console.log("super.x = 2 again:", B.x, B.read(), lookUp(B, "x"));

let sum = 0;
for (let i = 0; i < 1000; i++) {
  B.store(i);
  sum += B.x;
  Reflect.set(A, "x", i + 1, B);
  sum += B.read();
}
console.log("in a loop:", sum, B.x, Object.hasOwn(A, "x"));

console.log("deleted:", delete (B as any).x, lookUp(B, "x"));
B.m();
console.log("added by super.x = 2:", B.x, B.read(), lookUp(B, "x"));
console.log("deleted:", delete (B as any).x, Reflect.set({}, "x", 5, B), B.x, B.read(), lookUp(B, "x"));

class C extends B {}
C.m();
console.log("subclass as receiver:", C.x, B.x, Object.hasOwn(C, "x"), lookUp(C, "x"));
console.log("subclass as receiver:", Reflect.set({}, "y", 11, C), C.y, B.y, lookUp(C, "y"));

class Untyped {
  declare static x: unknown;
}
class Wide extends Untyped {
  static x: unknown = 1;
  static store(value: unknown): void {
    super.x = value;
  }
  static read(): unknown {
    return Wide.x;
  }
}
Wide.store("text");
console.log("another type by super:", Wide.x, Wide.read(), lookUp(Wide, "x"));
Wide.store(1.5);
console.log("another type by super:", Wide.x, Wide.read(), lookUp(Wide, "x"));
console.log("another type by Reflect.set:", Reflect.set({}, "x", null, Wide), Wide.x, Wide.read(), lookUp(Wide, "x"));
Wide.x = 7;
console.log("an integer again:", Wide.x, Wide.read(), lookUp(Wide, "x"));

class Frozen extends A {
  static x = 1;
  static m(): void {
    super.x = 2;
  }
}
Object.freeze(Frozen);
console.log("frozen:", attempt(() => Frozen.m()), Reflect.set({}, "x", 3, Frozen), Frozen.x, lookUp(Frozen, "x"));

class ReadOnly extends A {
  static x = 1;
  static m(): void {
    super.x = 2;
  }
}
Object.defineProperty(ReadOnly, "x", { writable: false });
console.log("read-only:", attempt(() => ReadOnly.m()), Reflect.set({}, "x", 3, ReadOnly), ReadOnly.x, lookUp(ReadOnly, "x"));

class Closed extends A {
  static m(): void {
    super.x = 2;
  }
}
Object.preventExtensions(Closed);
console.log("not extensible:", attempt(() => Closed.m()), Reflect.set({}, "x", 3, Closed), Closed.x, lookUp(Closed, "x"));

let accessorCalls = 0;
class Computed extends A {
  static get x(): number {
    return 40;
  }
  static set x(value: number) {
    accessorCalls++;
  }
  static m(): void {
    super.x = 2;
  }
}
console.log("accessor on the receiver:", attempt(() => Computed.m()), Reflect.set({}, "x", 3, Computed), Computed.x, accessorCalls);

const seen: string[] = [];
class WithSetter {
  static get x(): number {
    return -1;
  }
  static set x(value: number) {
    seen.push(`${this === Below ? "Below" : "another receiver"} ${value}`);
  }
}
class Below extends WithSetter {
  static x = 1;
  static m(): void {
    super.x = 2;
  }
}
Below.m();
console.log("setter on the parent:", Reflect.set(WithSetter, "x", 3, Below), Below.x, lookUp(Below, "x"), seen.join());

class Base {
  static m(): string {
    return "Base.m";
  }
  static other(): string {
    return "Base.other";
  }
}
class Derived extends Base {
  static shadow(f: () => string): void {
    super.m = f;
  }
  static call(): string {
    return Derived.m() + " " + this.m() + " " + super.m();
  }
}
class Further extends Derived {}
console.log("inherited:", Derived.m(), Derived.call(), Further.m(), Object.hasOwn(Derived, "m"));
Derived.shadow(() => "shadow");
console.log("super.m = f:", Derived.m(), Derived.call(), Further.m(), Base.m(), Object.hasOwn(Derived, "m"), Object.keys(Derived).join());
Derived.shadow(() => "second shadow");
console.log("super.m = f again:", Derived.m(), Derived.call(), Further.m(), Base.m());
console.log("deleted:", delete (Derived as any).m, Derived.m(), Derived.call(), Further.m());
console.log("Reflect.set:", Reflect.set({}, "other", () => "set by Reflect", Derived), Derived.other(), Further.other(), Base.other());
Further.shadow(() => "shadow on the subclass");
console.log("subclass as receiver:", Further.m(), Derived.m(), Base.m(), Object.hasOwn(Further, "m"));

class Own extends Base {
  static m(): string {
    return "Own.m";
  }
  static replace(f: () => string): void {
    super.m = f;
  }
  static call(): string {
    return Own.m();
  }
}
console.log("own method:", Own.m(), Own.call());
Own.replace(() => "replaced");
console.log("own method replaced:", Own.m(), Own.call(), Base.m(), Object.getOwnPropertyDescriptor(Own, "m")!.enumerable);

export {};
