// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const handler = {};
const proxy = new Proxy({}, handler);
console.log(proxy);
handler[["g", "et"].join("")] = () => (depth, options, inspect) => "a trap laid later: " + inspect({ a: 1 });
console.log(proxy);
