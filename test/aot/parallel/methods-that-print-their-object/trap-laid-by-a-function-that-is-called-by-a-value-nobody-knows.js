// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const handler = {};
const proxy = new Proxy({}, handler);
const lay = new CustomEvent("x", { detail: object => { object.get = () => (depth, options, inspect) => "laid by a callee nobody knows: " + inspect({ a: 1 }); } }).detail;
lay(new CustomEvent("y", { detail: handler }).detail);
console.log(Object.create(proxy));
