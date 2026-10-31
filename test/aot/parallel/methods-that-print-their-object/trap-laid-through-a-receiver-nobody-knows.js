// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const handler = {};
const proxy = new Proxy({}, handler);
const same = new CustomEvent("x", { detail: handler }).detail;
same.get = () => (depth, options, inspect) => "laid through a receiver nobody knows: " + inspect({ a: 1 });
console.log(Object.create(proxy));
