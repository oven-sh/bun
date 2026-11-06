// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const [key] = [["nodejs", "util", "inspect", "custom"].join(".")].map(Symbol.for);
console.log({ [key]: (depth, options, inspect) => "mapped: " + inspect(new Map([[1, 2]])) });
