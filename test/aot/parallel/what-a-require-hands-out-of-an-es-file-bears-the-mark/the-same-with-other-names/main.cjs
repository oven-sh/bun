const orchard = require("./orchard.mjs");
const { fruit, pick } = orchard;
console.log(fruit, pick(), Object.keys(orchard).join(), orchard.__esModule, require("./orchard.mjs") === orchard);
