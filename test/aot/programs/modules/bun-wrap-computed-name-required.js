// require() of "bun:wrap" by a name computed at run time, in a CommonJS file.
const name = "bun:" + ["wr", "ap"].join("");
const helpers = require(name);
console.log(typeof helpers.__toESM, helpers === require(name), helpers.__toESM({ a: 1 }).a);
console.log(Object.keys(require.cache).filter(key => /^bun:wrap$|prelude/.test(key)).join());
