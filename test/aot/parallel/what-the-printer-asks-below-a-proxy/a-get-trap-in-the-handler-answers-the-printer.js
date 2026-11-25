// The printer asks an object for one name, up its chain. A proxy in the chain answers by its `get` trap: the function that it hands out is called with util.inspect, which has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const below = Object.create(new Proxy({}, { get() { return answered; } }));
console.log(below);
