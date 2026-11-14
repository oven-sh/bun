// The handler is written in place and nobody else holds it, but a trap is called on it: `has` stores the `get` trap under `this`: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const proxy = new Proxy({}, { has() { this.get = () => answered; return true; } });
const below = Object.create(proxy);
console.log("anything" in below);
console.log(below);
