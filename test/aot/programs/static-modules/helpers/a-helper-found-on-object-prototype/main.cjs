// `(this && this.__exportStar) || function ..`: `this` is the exports object, which inherits from Object.prototype. Under `bun run` a function that the program puts there is taken for the helper. In an executable Object.prototype is read-only and the store throws a TypeError, from sloppy code too, so the expected output is written down.
if (process.argv.length < 99) {
  try {
    Object.prototype.__exportStar = function () {
      console.log("mine");
    };
  } catch (error) {
    console.log(error.constructor.name);
  }
}
console.log("keys:", Object.keys(require("./index.js")).join() || "none");
