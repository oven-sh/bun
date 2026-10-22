console.log("k begins");
exports.early = 1;
const main = require("./main.mjs");
exports.late = 2;
console.log("k ends", Object.keys(main).join(), main.value);
