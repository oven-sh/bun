// The same, by a rest parameter.
const seen = [];
const below = Object.create(new Proxy({}, { get(...operands) { if (typeof operands[1] === "symbol") seen.push(operands[1]); return undefined; } }));
console.log(below);
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(seen.length > 0, mine);
