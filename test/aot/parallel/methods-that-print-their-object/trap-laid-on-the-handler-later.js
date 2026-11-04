const handler = {};
const proxy = new Proxy({}, handler);
console.log(proxy);
handler[["g", "et"].join("")] = () => (depth, options, inspect) => "a trap laid later: " + inspect({ a: 1 });
console.log(proxy);
