console.log("old begins");
const side = require("./side.mjs");
console.log("old has", side.width);
throw new Error("old gives up");
console.log("old ends");
