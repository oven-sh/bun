// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
// A proxy stands above the object that is printed. Its get trap answers for the symbol that the printer asks for, and what it answers calls the `inspect` that it is handed.
const seen = [];
const above = new Proxy(
  {},
  {
    get(target, key) {
      seen.push(String(key));
      if (key !== Symbol.for("nodejs.util.inspect.custom")) return undefined;
      return function (depth, options, inspect) {
        return new Date(0).toISOString() + " " + inspect({ a: new Map([[1, new Set([2])]]) });
      };
    },
  },
);
console.log(Object.create(above));
console.log(seen.includes("Symbol(nodejs.util.inspect.custom)"));
