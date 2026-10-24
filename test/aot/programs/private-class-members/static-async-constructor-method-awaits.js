// `static async constructor() {}` is a static async method named `constructor`: it may await, returns a promise and cannot be constructed.
class Adds {
  static async constructor(x) {
    const value = await x;
    return value + 1;
  }
}
class Both {
  constructor() {
    this.made = true;
  }
  static async constructor() {
    await null;
    return new Both().made;
  }
}
const results = [];
results.push(Adds.constructor(Promise.resolve(1)) instanceof Promise);
results.push(await Adds.constructor(Promise.resolve(1)));
results.push(await Both.constructor());
results.push(Object.getPrototypeOf(Adds.constructor) === Object.getPrototypeOf(async function () {}));
results.push(Adds.constructor.name, Adds.constructor.length, "prototype" in Adds.constructor);
try {
  new Adds.constructor();
} catch (error) {
  results.push(error.name);
}
console.log(results.join("\n"));
