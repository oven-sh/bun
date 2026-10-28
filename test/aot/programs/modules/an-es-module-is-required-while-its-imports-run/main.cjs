// An es module is required while its imports run.
const a = require("./a.mjs");
console.log(Object.keys(a).join(), a.x, a.seen);
