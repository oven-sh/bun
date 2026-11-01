// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const register = Symbol["f" + "or"];
const key = Reflect.apply(register, Symbol, [["nodejs", "util", "inspect", "custom"].join(".")]);
console.log({ [key]: (depth, options, inspect) => "applied: " + inspect(new Set([1])) });
