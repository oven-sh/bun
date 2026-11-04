// The ring has run, entered by a require(). The calls of import() for its files find it so.
const b = require("./b.mjs");
console.log("require returned " + b.b);
Promise.all([import("./a.mjs"), import("./b.mjs")]).then(([a, again]) => console.log("loaded " + a.a + again.b, again.b === b.b));
