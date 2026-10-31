// RUN: lower
// OPTIONS: builtin-modules

// Prints the names of a function that a built-in module exports by default without a name, of a method that is named like a global function, and of the helpers of bun:wrap.
const wrap = require("bun:wrap");
console.log(require("@vercel/fetch").name);
console.log(require("node:http").ServerResponse.prototype.setTimeout.name);
console.log(require("node:http").ServerResponse.prototype.setTimeout);
for (const key of Object.keys(wrap)) if (typeof wrap[key] === "function") console.log(key, wrap[key].name, wrap[key].length);
