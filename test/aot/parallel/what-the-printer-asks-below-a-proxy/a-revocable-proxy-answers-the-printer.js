// Proxy.revocable() makes the proxy: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

const { proxy } = Proxy.revocable({}, { get() { return answered; } });
console.log(Object.create(proxy));
