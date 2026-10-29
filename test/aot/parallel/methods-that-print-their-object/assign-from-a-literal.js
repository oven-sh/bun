// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const source = { [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { return "assigned: " + inspect({ a: 1 }); } };
console.log(Object.assign({}, source), { ...source }, Object.fromEntries(Reflect.ownKeys(source).map(key => [key, source[key]])));
