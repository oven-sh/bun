// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = Bun.inspect[["cus", "tom"].join("")];
console.log({ [key]: (depth, options, inspect) => "computed name: " + inspect({ a: 1 }) });
