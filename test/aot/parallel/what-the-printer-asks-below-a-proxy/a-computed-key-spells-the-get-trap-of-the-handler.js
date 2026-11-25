// The handler is written in place, and the name of its one member is computed: it is `get`: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const name = process.argv.length > 50 ? "has" : "get";
const below = Object.create(new Proxy({}, { [name]() { return answered; } }));
console.log(below);
