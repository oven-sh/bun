// The trap returns nothing, but it is handed the symbol that the host asks for. With it the program lays a method on an object of its own.
const seen = [];
const below = Object.create(new Proxy({}, { get(target, key) { if (typeof key === "symbol") seen.push(key); return undefined; } }));
console.log(below);
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(seen.length > 0, mine);
