// Whoever reads `Symbol` under a key that nobody knows may have come by Symbol.for: the printer finds the method and hands it util.inspect.
const name = process.argv.length > 99 ? "keyFor" : "for";
const key = Symbol[name]("nodejs.util.inspect.custom");
const shown = {
  [key](depth, options, inspect) {
    return "printed with " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 });
  },
};
console.log(shown);
