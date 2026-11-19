// The same, and the trap names no parameter.
const seen = [];
const below = Object.create(new Proxy({}, { get() { if (typeof arguments[1] === "symbol") seen.push(arguments[1]); return undefined; } }));
console.log(below);
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(seen.length > 0, mine);
