// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = Symbol.for(process.env.KEY ?? ["nodejs", "util", "inspect", "custom"].join("."));
const printed = { plain: 1 };
printed[key] = function (depth, options, inspect) { return "registered text: " + inspect({ a: [1] }); };
console.log(printed);
