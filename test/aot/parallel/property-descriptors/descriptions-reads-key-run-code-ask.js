// The described object runs code of the program: a proxy's trap, a key that is converted.
const trapped = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(target, key) { console.log("trap", String(key)); return Reflect.getOwnPropertyDescriptor(target, key); }, get(target, key, receiver) { console.log("get trap", String(key)); return Reflect.get(target, key, receiver); } });
console.log(Object.getOwnPropertyDescriptor(trapped, "a"), Object.getOwnPropertyDescriptor(trapped, "b"));
console.log(Reflect.get(trapped, "a"), Reflect.get(trapped, "b"));
const key = { toString() { console.log("converted"); return "Array"; } };
console.log(Object.getOwnPropertyDescriptor(globalThis, key).value === Array, Reflect.get(globalThis, key) === Array);
const inherits = Object.create({ get up() { return "from above " + this.own; } }, { own: { value: 7 } });
console.log(Reflect.get(inherits, "up"), Reflect.get(inherits, "up", { own: 8 }), Object.getOwnPropertyDescriptor(inherits, "up"), Object.getOwnPropertyDescriptor(inherits, "own"));
const name = ["u", "p"].join("");
console.log(Reflect.get(inherits, name), Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inherits), name).get.call({ own: 9 }));
const list = [1, 2, 3]; Object.defineProperty(list, 1, { get() { return "from a getter"; } });
console.log(Reflect.get(list, 1), Reflect.get(list, "length"), Object.getOwnPropertyDescriptor(list, 1).get(), [0].concat(list));
console.log(Reflect.get(process, "pid") === process.pid, typeof Reflect.get(process, ["plat", "form"].join("")), typeof Reflect.get(Bun, "version"), typeof Reflect.get(Bun, ["ver", "sion"].join("")));
console.log(typeof Object.getOwnPropertyDescriptor(process, ["ver", "sions"].join("")).value.bun, typeof Object.getOwnPropertyDescriptor(Bun, ["en", "v"].join("")));
