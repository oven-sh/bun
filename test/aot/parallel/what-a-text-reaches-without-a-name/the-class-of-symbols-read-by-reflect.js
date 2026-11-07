// Reflect.get() reads Symbol.for off the class that it is handed.
const key = Reflect.get(Symbol, "for")("nodejs.util.inspect.custom");
const shown = {
  [key](depth, options, inspect) {
    return "printed with " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 });
  },
};
console.log(shown);
