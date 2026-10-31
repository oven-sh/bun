// Bun.$, Bun.sql and Bun.postgres are functions whose prototype is an object of their own, not Function.prototype.
console.log(Object.getPrototypeOf(Bun.$) === Function.prototype, Object.getPrototypeOf(Bun.$).constructor.name);
console.log(Object.getPrototypeOf(Bun.sql) === Function.prototype, Object.getPrototypeOf(Bun.sql).constructor.name);
console.log(Object.getPrototypeOf(Bun.postgres) === Function.prototype, Object.getPrototypeOf(Bun.postgres).constructor.name);
