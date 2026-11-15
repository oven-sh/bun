// A descriptor hands Symbol.for out as a value.
const key = Object.getOwnPropertyDescriptor(Symbol, "for").value("nodejs.util.inspect.custom");
const shown = {
  [key](depth, options, inspect) {
    return "printed with " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 });
  },
};
console.log(shown);
