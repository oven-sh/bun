// A name that the exports lack, or do not have yet, is looked for on Object.prototype. In an executable Object.prototype is read-only and a store to it throws a TypeError, from sloppy code too, so the expected output is written down.
if (process.argv.length < 99) {
  for (const name of ["ghost", "late"]) {
    try {
      Object.prototype[name] = "p";
    } catch (error) {
      console.log(name, error.constructor.name);
    }
  }
}
console.log(require("./a.cjs").ghost);
require("./cycle-a.cjs");
