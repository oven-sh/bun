// Two makers of proxies in one program: a construction over an empty handler, which brings nothing, and Proxy.revocable() with a `get` trap: util.inspect has to be in the executable.
function answered(depth, options, inspect) { return "printed by the program with " + typeof inspect + " " + inspect({ deep: [1, { two: 2 }] }, { depth: 0 }); }

new Proxy({}, {});
const { proxy } = Proxy.revocable({}, { get() { return answered; } });
console.log(Object.create(proxy));
