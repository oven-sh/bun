function f() { return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)) }; }
const r = f();
console.log(r.above === null, r.above === Function.prototype, typeof r.above, r.above ? "truthy" : "falsy", r.above ?? "nullish" ? 1 : 0, r.above?.constructor === Function);
