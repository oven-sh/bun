const { held } = require("./lib.mjs");
console.log(held.peek(Promise.resolve(1)));
