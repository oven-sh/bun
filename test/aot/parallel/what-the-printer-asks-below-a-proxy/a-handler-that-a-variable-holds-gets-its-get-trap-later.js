// The handler is empty where the proxy is made, and a variable holds it: the `get` trap is stored afterwards: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const handler = {};
const below = Object.create(new Proxy({}, handler));
handler.get = () => answered;
console.log(below);
