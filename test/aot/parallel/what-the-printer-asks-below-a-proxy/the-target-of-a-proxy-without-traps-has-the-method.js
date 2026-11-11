// Without a `get` trap the question of the printer goes on at the target, which has the method: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const target = { [Symbol.for("nodejs.util.inspect.custom")]: answered };
const below = Object.create(new Proxy(target, {}));
console.log(below);
