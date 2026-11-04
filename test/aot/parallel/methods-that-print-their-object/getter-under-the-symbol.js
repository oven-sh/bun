// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
console.log({ get [Symbol.for("nodejs.util.inspect.custom")]() { return (depth, options, inspect) => "out of a getter: " + inspect({ a: 1 }); } });
