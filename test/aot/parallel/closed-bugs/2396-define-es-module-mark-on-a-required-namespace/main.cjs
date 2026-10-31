const m = require("./e.mjs");
console.log(m.__esModule, m.x);
require("./other.cjs");
console.log(m.__esModule, m.x);
const { __esModule: marker } = require("./e.mjs");
console.log(marker);
