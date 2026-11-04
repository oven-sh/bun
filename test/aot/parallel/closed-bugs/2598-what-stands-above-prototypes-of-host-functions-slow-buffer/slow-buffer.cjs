const above = Object.getPrototypeOf(Object.getPrototypeOf(require("node:buffer").SlowBuffer));
console.log(above === null, above === Object.prototype, typeof above, above ? "truthy" : "falsy", String(above), above?.constructor === Object);
const kept = { above };
console.log(kept.above === null, kept.above == null, kept.above ?? "nullish", JSON.stringify(Object.keys(kept)));
