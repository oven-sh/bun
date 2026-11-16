// Behind a `get` trap the engine asks the target for its own property under the same name. The target is a proxy, so its trap is handed the symbol that the host asks for.
const seen = [];
const inner = new Proxy({}, { getOwnPropertyDescriptor(target, key) { if (typeof key === "symbol") seen.push(key); return undefined; } });
const below = Object.create(new Proxy(inner, { get() { return "a"; } }));
console.log(below);
console.log(seen.length > 0);
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(mine);
