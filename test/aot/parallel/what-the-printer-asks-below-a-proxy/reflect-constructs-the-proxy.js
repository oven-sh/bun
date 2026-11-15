// Reflect.construct() makes the proxy, so the construction is not in sight: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const below = Object.create(Reflect.construct(Proxy, [{}, { get() { return answered; } }]));
console.log(below);
