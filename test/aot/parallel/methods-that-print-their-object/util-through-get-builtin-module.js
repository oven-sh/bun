// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = process.getBuiltinModule("node:util").inspect.custom;
console.log({ [key]: (depth, options, inspect) => "getBuiltinModule: " + inspect({ a: 1 }) });
