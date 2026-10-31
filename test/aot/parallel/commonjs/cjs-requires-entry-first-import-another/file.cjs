exports.count = 1;
const main = require("./main.mjs");
console.log("the file sees", Object.keys(main).join(), "|", Object.keys(main.stars).join(), "|", main.stars.first, main.stars.last, "|", main.first, main.last);
