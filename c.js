const a = require("node:dns/promises");
const b = require("node:dns");

const r = await a.resolve("example.com");
console.log(r);

b.resolve("example.com", console.log);
