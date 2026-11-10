// The method is laid under the symbol that the printer looks for: it is called with util.inspect, which nobody names.
console.log({
  [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) {
    return "printed by the method " + typeof inspect;
  },
});
