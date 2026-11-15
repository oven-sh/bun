// Object.assign stores under every own enumerable key of its source, symbols too.
const seen = [];
const watched = new Proxy({}, { set(target, key) { if (typeof key === "symbol") seen.push(key); return true; } });
Object.assign(watched, Buffer.prototype);
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(seen.length > 0, mine);
