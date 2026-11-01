// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const custom = Symbol.for("nodejs.util.inspect.custom");
const event = new CustomEvent("x", { detail: (depth, options, inspect) => "through an event: " + inspect({ a: 1 }) });
const printed = {};
printed[custom] = event.detail;
console.log(printed);
