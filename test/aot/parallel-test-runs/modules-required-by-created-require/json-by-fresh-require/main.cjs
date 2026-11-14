const { createRequire } = require("node:module");
const two = createRequire(__filename)("./d.json");
const one = two;
console.log("SAID", tree(module), one === two, one.parent ?? "none", String(!!require.cache[require.resolve("./d.json")]), "");
