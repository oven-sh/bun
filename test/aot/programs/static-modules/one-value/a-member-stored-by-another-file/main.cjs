// A second file stores a member on the function that a first file exports, and a third file calls it.
const f = require("./f.cjs");
console.log(f());
require("./plugin.cjs");
console.log(f(), require("./reader.cjs")(), Object.keys(f).join());
