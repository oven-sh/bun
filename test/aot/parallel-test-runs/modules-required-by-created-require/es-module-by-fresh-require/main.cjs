const { createRequire } = require("node:module");
const one = require("./e.mjs");
const two = createRequire(__filename)("./e.mjs");
console.log("SAID", tree(module), one === two, one.parent ?? "none", String(!!require.cache[require.resolve("./e.mjs")]), "");
