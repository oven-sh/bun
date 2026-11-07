// A pattern takes the constructor under a key that folds.
const key = "constructor";
const { [key]: make } = () => {};
console.log(make("return Bun.inspect({ a: 1 })")());
