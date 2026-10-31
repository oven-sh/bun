// util.inspect takes the name of a value whose prototype chain has no usable constructor from native code: each row of the table that the test of plain Bun holds, an object that the compiler laid out, a class or a function that holds the name, the prototype object of a class and the namespace of a module.
import { inspect } from "node:util";
import rows from "../../../../js/node/util/node-inspect-tests/constructor-name-fixture.cjs";
import defer * as later from "./later.ts";
import * as self from "./main.ts";

// Data under the name that the lookup reads: it must not name the namespace.
export const constructor = { name: { toString: 1 } };

class Foo {
  a = 1;
}
class Tagged {
  [Symbol.toStringTag] = "Tag";
  x = 1;
}
// instanceof answers false for each instance, so the lookup passes the constructor of the class by.
class Denies {
  static [Symbol.hasInstance]() {
    return false;
  }
}
class Heir extends Denies {
  a = 1;
}
Object.setPrototypeOf(Denies.prototype, null);
function Bar() {}
async function asyncFunction() {}

const bare = (): object => Object.create(null);
const child = Object.create;
const reproto = Object.setPrototypeOf;
const withConstructor = (value: unknown): object =>
  Object.defineProperty(bare(), "constructor", { value, writable: true, configurable: true });
// No row throws: an error ends the program, and the run of plain Bun fails with it.
function say(label: string, print: () => string) {
  console.log(`${label}: ${print().replace(/\s+/g, " ")}`);
}

// The table of the test of plain Bun. Its file is compiled with this one, so its functions and classes are compiled too.
const table = rows as unknown as {
  constructorNames: [label: string, print: () => string][];
  builtinNames: [label: string, make: () => object][];
  differsFromNode: [label: string, print: () => string][];
  getterRuns: string[];
  builtinName(make: () => object): object;
};
for (const [label, print] of table.constructorNames) {
  table.getterRuns.length = 0;
  say(label, () => `${print()} after the getters ${table.getterRuns.join()}`);
}
for (const [label, make] of table.builtinNames) say(label, () => JSON.stringify(table.builtinName(make)));
for (const [label, print] of table.differsFromNode) say(label, print);

// Own properties of an object that the compiler laid out. The native code reads each where the program stored it last.
const instance = new Tagged();
reproto(instance, null);
say("child of an instance with a tag field", () => inspect(child(instance)));
for (const tag of ["Second", "Third"]) {
  instance[Symbol.toStringTag] = tag;
  say("child of that instance with another tag", () => inspect(child(instance)));
}
const literal: { constructor: Function; x: number } = { constructor: Foo, x: 1 };
reproto(literal, null);
say("child of a literal with a constructor", () => inspect(child(literal)));
for (const made of [Bar, asyncFunction]) {
  literal.constructor = made;
  say("child of that literal with another constructor", () => inspect(child(literal)));
}
let getterRuns = 0;
const guarded = {
  get constructor() {
    getterRuns++;
    return Foo;
  },
  x: 1,
};
reproto(guarded, null);
say("child of a literal whose constructor is a getter", () => inspect(child(guarded)));
console.log("runs of that getter:", getterRuns);
// A property that the program defines on an instance later lies beside its fields.
const extended = new Foo();
Object.defineProperty(extended, Symbol.toStringTag, { value: "Defined" });
reproto(extended, null);
say("child of an instance with a tag that was defined later", () => inspect(child(extended)));
const built = new Foo();
Object.defineProperty(built, "constructor", { value: Bar });
reproto(built, null);
say("child of an instance with a constructor that was defined later", () => inspect(child(built)));

// A class or a function holds the name.
class WithStaticTag {
  static [Symbol.toStringTag] = "StaticTag";
}
reproto(WithStaticTag, bare());
say("class with a static tag", () => inspect(WithStaticTag));
say("child of a class with a static tag", () => inspect(child(WithStaticTag)));
class Base {}
class Derived extends Base {
  static [Symbol.toStringTag] = "DerivedTag";
}
reproto(Base, bare());
say("child of a derived class with a static tag", () => inspect(child(Derived)));
const taggedFunction = function taggedFunction() {};
Object.defineProperty(taggedFunction, Symbol.toStringTag, { value: "FunctionTag" });
reproto(taggedFunction, bare());
say("child of a function with a tag", () => inspect(child(taggedFunction)));
const arrowWithConstructor = () => {};
Object.defineProperty(arrowWithConstructor, "constructor", { value: Foo, writable: true, configurable: true });
reproto(arrowWithConstructor, bare());
say("child of an arrow with a constructor", () => inspect(child(arrowWithConstructor)));

// A key that the compiler works out names a function when the program runs, so the function was made with no name.
enum Key {
  Handler = "onEvent",
}
class Computed {
  [Key.Handler]() {}
  ["field"] = () => {};
  static ["constructor"]() {}
}
say("constructor that is a method under an enum member", () =>
  inspect(child(withConstructor(Computed.prototype[Key.Handler]))),
);
say("constructor that is a field under a quoted key", () => inspect(child(withConstructor(new Computed().field))));
reproto(Computed, bare());
say("child of a class with a static method under the quoted key constructor", () => inspect(child(Computed)));

// The prototype object of a class names its instances.
say("instance of a class that denies it", () => inspect(new Denies()));
say("instance of its heir", () => inspect(new Heir()));
say("child of an instance of its heir", () => inspect(child(new Heir())));

// The namespace of a compiled module.
say("namespace", () => inspect(self));
say("namespace, past the depth", () => inspect({ a: self }, { depth: 0 }));
say("deferred namespace, past the depth", () => inspect({ a: later }, { depth: 0 }));
say("deferred namespace", () => inspect(later));
