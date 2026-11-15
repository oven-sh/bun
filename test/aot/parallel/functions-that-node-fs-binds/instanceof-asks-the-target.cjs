// node:fs binds these functions. `instanceof` asks the target of a bound function, a method without a prototype, and never the prototype that the program gives the bound function.
const fs = require("fs");
const names = ["appendFileSync", "chmodSync", "closeSync", "fstatSync", "lstatSync", "readFileSync", "readdirSync", "statSync", "accessSync"];
function ask(test) {
  try { return String(test()); } catch (error) { return error.name + ": " + error.message; }
}
for (const name of names) {
  const f = fs[name], prototype = { a: 1 }, below = Object.create(prototype);
  console.log(name, f.name, f.length, Reflect.ownKeys(f).join(), "prototype" in f, f.toString());
  console.log(ask(() => below instanceof f), ask(() => 1 instanceof f));
  f.prototype = prototype;
  console.log(JSON.stringify(Object.getOwnPropertyDescriptor(f, "prototype")), f.prototype === prototype);
  console.log(ask(() => below instanceof f), ask(() => ({}) instanceof f), ask(() => 1 instanceof f), ask(() => null instanceof f));
  console.log(ask(() => Function.prototype[Symbol.hasInstance].call(f, below)), ask(() => f[Symbol.hasInstance]("text")));
  console.log(ask(() => below instanceof f.bind(null)), ask(() => below instanceof new Proxy(f, {})), ask(() => below instanceof Object.create(f)).split(":")[0]);
  console.log(ask(() => { class X extends f {} }), ask(() => Reflect.construct(Object, [], f)), ask(() => Reflect.construct(f, [])));
  let asked = 0;
  Object.defineProperty(f, "prototype", { get() { asked++; return prototype; }, configurable: true });
  console.log(ask(() => below instanceof f), asked, delete f.prototype, "prototype" in f, ask(() => below instanceof f));
}

// The functions as the program spells them, and one expression that asks each of them.
fs.readFileSync.prototype = Array.prototype;
fs.closeSync.prototype = Array.prototype;
console.log(ask(() => [] instanceof fs.readFileSync), ask(() => [] instanceof fs.closeSync), Array.isArray(fs.closeSync.prototype));
const isInstance = (value, f) => value instanceof f;
for (let i = 0; i < 40; i++) {
  const f = [Array, fs.readFileSync, Map, fs.closeSync, Object][i % 5];
  if (i < 5 || i > 34) console.log(i, ask(() => isInstance([], f)), ask(() => isInstance("text", f)));
}

// A function that the program binds to one of them, and one that the program writes.
const bound = fs.statSync.bind(fs), written = { method() {} }.method;
bound.prototype = written.prototype = Array.prototype;
console.log(ask(() => [] instanceof bound), ask(() => [] instanceof written));
