function isMap(x) { try { return x instanceof Map; } catch (error) { return error.constructor.name + ": " + error.message; } }
globalThis.kept = isMap;
const said = [];
const trapped = new Proxy({}, { getPrototypeOf() { said.push("asked"); return Map.prototype; } });
const throwing = new Proxy({}, { getPrototypeOf() { throw new RangeError("no parent"); } });
const below = Object.create(trapped);
const moved = {};
console.log(globalThis.kept(trapped), globalThis.kept(below), globalThis.kept(throwing), globalThis.kept(Object.create(throwing)), globalThis.kept(moved), said.join());
Object.setPrototypeOf(moved, Map.prototype);
console.log(globalThis.kept(moved), globalThis.kept(Object.create(moved)), globalThis.kept(Map.prototype), globalThis.kept(Object.create(null)), globalThis.kept(Map));
Object.setPrototypeOf(moved, null);
console.log(globalThis.kept(moved));
