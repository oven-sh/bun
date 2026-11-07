// A name that no access spells, only the text handed to Object.defineProperty or Reflect.set as the key, is a name like any other: on the global object and on an object of the program.
Object.defineProperty(globalThis, "definedName", { value: 3, configurable: true, writable: true });
console.log(Reflect.get(globalThis, "definedName"), Object.hasOwn(globalThis, "definedName"), Reflect.has(globalThis, "neverDefined"));
Reflect.set(globalThis, "setName", 4);
console.log(Object.getOwnPropertyDescriptor(globalThis, "setName").value);
console.log(Reflect.deleteProperty(globalThis, "setName"), Reflect.has(globalThis, "setName"));

const target = { plain: 1 };
Object.defineProperty(target, "hidden", { value: 2, enumerable: false });
Object.defineProperty(target, "computed", { get() { return this.plain + 10; }, enumerable: true });
console.log(Object.keys(target), Reflect.get(target, "hidden"), Reflect.get(target, "computed"), JSON.stringify(target));
target.plain = 5;
console.log(Reflect.get(target, "computed"), Object.getOwnPropertyNames(target));

Object.defineProperty(Date, "now", { value: () => 6 });
console.log(Date.now(), typeof Date.parse("2000-01-01"), typeof Buffer.from);
