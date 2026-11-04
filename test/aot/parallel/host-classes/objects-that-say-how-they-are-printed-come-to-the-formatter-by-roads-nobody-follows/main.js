// An object whose own way of being printed is found under Symbol.for("nodejs.util.inspect.custom") comes to console.log by roads on which nobody can follow it.
const custom = Symbol.for("nodejs.util.inspect.custom");
const text = process.argv.length > 99 ? process.argv[99] : '{"kind":"point","x":1,"inner":{"kind":"point","x":2}}';

const revived = JSON.parse(text, function (name, value) {
  if (value && value.kind === "point") value[custom] = function (depth, options, inspect) { return "Point(" + inspect(this.x) + ")"; };
  return value;
});
console.log("from a reviver:", revived);
console.log("below a list:", [revived.inner]);

const behindProxy = new Proxy({ plain: 1 }, {
  get(target, name, receiver) {
    if (name === custom) return (depth, options, inspect) => "Proxied " + typeof inspect + " " + typeof options.stylize;
    return Reflect.get(target, name, receiver);
  },
});
console.log("from a proxy:", behindProxy);

console.log("from a dependency:", require("shapes").make(3));

const holder = {
  get shape() {
    return { [custom]: (depth, options, inspect) => "Got " + inspect({ a: [1, { b: 2 }] }, { ...options, depth: 0 }) };
  },
};
console.log("from a getter:", holder.shape);
console.log("a holder with a getter:", holder);

try {
  null.x;
} catch (error) {
  error[custom] = function (depth, options, inspect) { return "Caught " + this.constructor.name + " " + inspect(new Map([[1, new Set([2])]])); };
  console.log("an error of the run time:", error);
}

const table = {};
table[process.argv.length > 99 ? "other" : "made"] = { [Symbol.for(["nodejs.util", "inspect.custom"].join("."))]() { return "Under a key put together at run time"; } };
console.log(table.made);
console.error("to the other stream:", table[Object.keys(table)[0]]);
console.log("%o and %O", revived, holder.shape);
console.log(Bun.inspect(revived), require("node:util").inspect(revived), require("node:util").format("%s", holder.shape));
