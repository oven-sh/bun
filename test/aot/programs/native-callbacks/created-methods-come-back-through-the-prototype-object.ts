// Held from creation: the program walks from an instance to the prototype object of its class with native functions, gets the names and the methods back as `any`, and calls each method with a string and with another `this`.
let total = 0;

class Suite {
  weight = 1;
  first(times: number): void {
    total += typeof times === "number" ? times : this instanceof Suite ? 100 : 10000;
  }
  second(times: number): void {
    total += typeof times === "number" ? times : this instanceof Suite ? 1000000 : 100000000;
  }
}

const suite = new Suite();
suite.first(1);
suite.second(1);
const prototype = Object.getPrototypeOf(suite);
for (const name of Object.getOwnPropertyNames(prototype)) {
  if (name === "constructor") continue;
  prototype[name].call(suite, "text");
  Reflect.get(prototype, name).call({}, "text");
  Object.getOwnPropertyDescriptor(prototype, name)!.value.call(undefined, 1);
}
console.log(total, new prototype.constructor().weight, Reflect.ownKeys(prototype).length);
