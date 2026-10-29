// Reference: bun build --compile
// require() of a data file that was imported before returns the parsed value, not the namespace.
const plain = await import("./record.json");
const required = require("./record.json");
console.log(required === plain, required === plain.default, Object.prototype.toString.call(required));
