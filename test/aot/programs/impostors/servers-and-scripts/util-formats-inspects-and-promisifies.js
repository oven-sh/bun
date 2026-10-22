import util from "node:util";

console.log(util.format("%s has %d items costing %f, %i whole, %j %o %%", "cart", 3, 9.75, 4.9, { a: 1 }, [1]), util.format("no", "pattern", 5, { b: 2 }));
console.log(util.inspect({ name: "Ada", nested: { deep: { deeper: { deepest: 1 } } }, list: [1, "two", null, undefined], when: new Date(0), pattern: /x+/g }, { depth: 1 }));
console.log(util.inspect(new Map([["k", new Set([1, 2])]])), util.inspect("text"), util.inspect(Symbol("s")), util.inspect(12n), util.inspect(-0), util.inspect([, 1]));
console.log(util.inspect({ a: 1, b: "x" }, { compact: false }), util.inspect("a".repeat(30), { maxStringLength: 5 }), util.inspect(Array.from({ length: 8 }, (_, i) => i), { maxArrayLength: 3 }));
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  [util.inspect.custom](depth, options) {
    return "Point<" + this.x + "," + this.y + ">";
  }
}
console.log(util.inspect(new Point(1, 2)), util.inspect([new Point(3, 4)]), `${util.inspect(class A {})} ${util.inspect(function named() {})} ${util.inspect(() => {})}`);

function later(value, callback) {
  setTimeout(() => (value < 0 ? callback(new RangeError("negative")) : callback(null, value * 2)), 1);
}
const promised = util.promisify(later);
console.log(await promised(21), await promised(-1).catch(error => error.message));
util.callbackify(async value => value + 1)(1, (error, value) => console.log("callbackified", error, value));
console.log(util.isDeepStrictEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), util.isDeepStrictEqual([1], ["1"]), util.types.isPromise(promised(1)), util.types.isRegExp(/x/), util.types.isDate({}));
console.log(util.parseArgs({ args: ["--port", "80", "-v", "file.txt"], options: { port: { type: "string" }, v: { type: "boolean", short: "v" } }, allowPositionals: true }));
console.log(new util.TextDecoder().decode(new util.TextEncoder().encode("héllo")), util.stripVTControlCharacters("\u001b[31mred\u001b[0m"), util.inherits.length, typeof util.deprecate(() => 1, "old")());
