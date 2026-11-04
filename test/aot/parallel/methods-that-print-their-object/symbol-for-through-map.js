const [key] = [["nodejs", "util", "inspect", "custom"].join(".")].map(Symbol.for);
console.log({ [key]: (depth, options, inspect) => "mapped: " + inspect(new Map([[1, 2]])) });
