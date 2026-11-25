const { createRequire } = require("node:module");
const c = createRequire(__filename)("./c.cjs");
const b = require("./b.cjs");
console.log("SAID", tree(module), c.parent, c.b === b, b.parent, tree(require.cache[require.resolve("./c.cjs")]));
