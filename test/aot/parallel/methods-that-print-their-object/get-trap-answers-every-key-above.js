// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const answer = function (depth, options, inspect) { return "every key, from above: " + (typeof inspect === "function" ? inspect([1]) : typeof inspect); };
console.log(Object.create(new Proxy({}, { get: () => answer })));
