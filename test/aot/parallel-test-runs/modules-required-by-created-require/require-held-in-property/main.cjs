const { createRequire } = require("node:module");
const holder = { made: createRequire(__filename) };
const one = require("./b.cjs");
const two = holder.made("./b.cjs");
console.log("SAID", tree(module), one === two, one.parent ?? "none", String(!!require.cache[require.resolve("./b.cjs")]), "", Object.keys(holder.made.cache ?? {}).length > 0, holder.made.main === require.main);
