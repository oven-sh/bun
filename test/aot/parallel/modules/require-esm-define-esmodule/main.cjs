// Another file defines `__esModule` with a string value on the namespace object of a required ES module.
const m = require("./e.mjs");
console.log(m.__esModule, m.x);
require("./other.cjs");
console.log(m.__esModule, m.x);
const { __esModule: marker } = require("./e.mjs");
console.log(marker);
