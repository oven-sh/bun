// require() of a data file that import() has loaded before answers the namespace object of that import.
const plain = await import("./record.json");
const required = require("./record.json");
console.log(required === plain, required === plain.default, Object.prototype.toString.call(required));
