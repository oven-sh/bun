const source = { [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { return "assigned: " + inspect({ a: 1 }); } };
console.log(Object.assign({}, source), { ...source }, Object.fromEntries(Reflect.ownKeys(source).map(key => [key, source[key]])));
