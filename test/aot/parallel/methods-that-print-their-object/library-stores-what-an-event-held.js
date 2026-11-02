// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const event = new CustomEvent("x", { detail: (depth, options, inspect) => "the library stores what an event held: " + inspect({ a: 1 }) });
console.log(require("node:querystring").decode("a=b", null, null, { decodeURIComponent: text => (text === "a" ? Bun.inspect.custom : event.detail) }));
