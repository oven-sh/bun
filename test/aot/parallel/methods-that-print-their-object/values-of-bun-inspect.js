// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = Object.values(Object.getOwnPropertyDescriptors(Bun.inspect)).map(descriptor => descriptor.value).find(value => typeof value === "symbol");
console.log(typeof key);
console.log({ [key]: (depth, options, inspect) => "a value of Bun.inspect: " + inspect({ a: 1 }) });
