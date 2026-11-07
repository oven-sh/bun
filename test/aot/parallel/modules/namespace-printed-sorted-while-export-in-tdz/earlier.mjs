import * as later from "./later.mjs";

console.log(Bun.inspect(later, { sorted: true, compact: true }));
console.log(Bun.inspect({ later, list: [later] }, { sorted: true, compact: true }));
console.log(Bun.inspect(later, { compact: true }));
