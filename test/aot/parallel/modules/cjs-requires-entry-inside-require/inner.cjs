console.log("inner begins");
exports.early = 1;
console.log("inner got", require("./main.mjs").answer);
exports.late = 2;
console.log("inner ends");
