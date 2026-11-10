// A key that folds to "constructor" reads what `.constructor` reads.
const key = "constructor";
const make = (() => {})[key];
console.log(make("return Bun.inspect({ a: 1 })")());
