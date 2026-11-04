// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const handler = {};
const proxy = new Proxy({}, handler);
Object.assign(handler, JSON.parse("{}"), { get: () => (depth, options, inspect) => "a trap laid by assign: " + inspect({ a: 1 }) });
console.log(proxy);
