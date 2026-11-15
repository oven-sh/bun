// `Proxy` comes out of a list, so the construction is not in sight: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const Made = [Proxy][process.argv.length > 50 ? 1 : 0];
const below = Object.create(new Made({}, { get() { return answered; } }));
console.log(below);
