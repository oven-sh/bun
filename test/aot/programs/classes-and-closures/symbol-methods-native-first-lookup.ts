// Native code makes the first lookup of a symbol-named member of a class, before compiled code has read anything from the prototype or from the class: it finds the member, on the class itself and through a subclass.
import { inspect } from "node:util";

class Bag {
  constructor(private items: number[]) {}
  *[Symbol.iterator](): Generator<number> {
    yield* this.items;
  }
}
console.log("Array.from:", Array.from(new Bag([1, 2, 3])).join());

class SetSource {
  *[Symbol.iterator](): Generator<string> {
    yield "a";
    yield "b";
    yield "a";
  }
}
console.log("new Set:", new Set(new SetSource()).size);

class Pairs {
  *[Symbol.iterator](): Generator<[string, number]> {
    yield ["x", 1];
    yield ["y", 2];
  }
}
console.log("Object.fromEntries:", JSON.stringify(Object.fromEntries(new Pairs())));

class BaseBag {
  *[Symbol.iterator](): Generator<number> {
    yield 7;
    yield 8;
  }
}
class DerivedBag extends BaseBag {
  unused(): number {
    return 0;
  }
}
console.log("Array.from through a subclass:", Array.from(new DerivedBag()).join());

class Promises {
  *[Symbol.iterator](): Generator<Promise<number> | number> {
    yield Promise.resolve(1);
    yield 2;
  }
}
console.log("Promise.all:", (await Promise.all(new Promises())).join());

class Stream {
  async *[Symbol.asyncIterator](): AsyncGenerator<number> {
    yield 4;
    yield 5;
  }
}
console.log("Array.fromAsync:", (await Array.fromAsync(new Stream())).join());

class Money {
  constructor(private cents: number) {}
  [Symbol.toPrimitive](hint: string): string | number {
    return hint === "number" ? this.cents : `${hint} $${this.cents / 100}`;
  }
}
console.log("template literal:", `${new Money(250)}`);

class Weight {
  [Symbol.toPrimitive](hint: string): string | number {
    return hint === "number" ? 12 : hint;
  }
}
console.log("Number:", Number(new Weight()));

class Label {
  [Symbol.toPrimitive](hint: string): string {
    return "label by " + hint;
  }
}
console.log("String:", String(new Label()));

class Key {
  [Symbol.toPrimitive](hint: string): string {
    return "key by " + hint;
  }
}
console.log("property key:", Reflect.get({ "key by string": "found" }, new Key() as any));

class BaseMoney {
  [Symbol.toPrimitive](hint: string): string {
    return "inherited " + hint;
  }
}
class DerivedMoney extends BaseMoney {}
console.log("template literal through a subclass:", `${new DerivedMoney()}`);

class Inspected {
  secret = 1;
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "Inspected<hidden>";
  }
}
console.log("Bun.inspect:", Bun.inspect(new Inspected()));

class Logged {
  secret = 2;
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "Logged<hidden>";
  }
}
console.log("console.log:", new Logged());

class InspectedByNode {
  secret = 3;
  [inspect.custom](): string {
    return "InspectedByNode<hidden>";
  }
}
console.log("util.inspect:", inspect(new InspectedByNode()));

class BaseInspected {
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "BaseInspected<hidden>";
  }
}
class DerivedInspected extends BaseInspected {
  secret = 4;
}
console.log("Bun.inspect through a subclass:", Bun.inspect(new DerivedInspected()), Bun.inspect([new DerivedInspected()]));

class Even {
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "number" && value % 2 === 0;
  }
}
const two: unknown = 2;
const three: unknown = 3;
console.log("instanceof:", two instanceof Even, three instanceof Even, Object.create(Even.prototype) instanceof Even);

class BaseEven {
  static [Symbol.hasInstance](value: unknown): boolean {
    return value === 4;
  }
}
class DerivedEven extends BaseEven {}
const four: unknown = 4;
console.log("instanceof through a subclass:", four instanceof DerivedEven, new DerivedEven() instanceof DerivedEven);

class Odd {
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "number" && value % 2 === 1;
  }
}
console.log("Function.prototype[Symbol.hasInstance]:", Function.prototype[Symbol.hasInstance].call(Odd, 3), Reflect.apply(Odd[Symbol.hasInstance], Odd, [3]));

class Tagged {
  get [Symbol.toStringTag](): string {
    return "Tagged by a getter";
  }
}
console.log("Object.prototype.toString:", Object.prototype.toString.call(new Tagged()));

class Spread {
  length = 2;
  0 = "first";
  1 = "second";
  get [Symbol.isConcatSpreadable](): boolean {
    return true;
  }
}
console.log("concat:", JSON.stringify(([] as unknown[]).concat(new Spread())));

class Replacer {
  [Symbol.replace](subject: string, replacement: string): string {
    return `replace ${subject} ${replacement}`;
  }
}
class Splitter {
  [Symbol.split](subject: string, limit?: number): string[] {
    return ["split", subject, String(limit)];
  }
}
class Searcher {
  [Symbol.search](subject: string): number {
    return subject.length;
  }
}
class Matcher {
  [Symbol.match](subject: string): RegExpMatchArray | null {
    return ["match " + subject];
  }
}
function callStringMethods(subject: string): string {
  return [subject.replace(new Replacer(), "x"), subject.split(new Splitter()).join(), subject.search(new Searcher()), subject.match(new Matcher())].join(" | ");
}
console.log("String methods:", callStringMethods("abc"));

class Listed {
  [Symbol.iterator](): Iterator<number> {
    return [][Symbol.iterator]();
  }
  static [Symbol.hasInstance](): boolean {
    return false;
  }
  get [Symbol.toStringTag](): string {
    return "Listed";
  }
}
console.log("own symbols:", Object.getOwnPropertySymbols(Listed.prototype).map(String).join(), "|", Object.getOwnPropertySymbols(Listed).map(String).join());

class Described {
  [Symbol.toPrimitive](): number {
    return 1;
  }
}
const descriptor = Object.getOwnPropertyDescriptor(Described.prototype, Symbol.toPrimitive)!;
console.log("descriptor:", typeof descriptor.value, descriptor.value.name, descriptor.writable, descriptor.enumerable, descriptor.configurable);
