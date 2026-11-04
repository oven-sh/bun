const key = process.getBuiltinModule("node:util").inspect.custom;
console.log({ [key]: (depth, options, inspect) => "getBuiltinModule: " + inspect({ a: 1 }) });
