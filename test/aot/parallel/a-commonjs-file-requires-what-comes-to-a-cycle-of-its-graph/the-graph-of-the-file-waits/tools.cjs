process.on("uncaughtException", error => console.log("uncaught", error.code));
console.log("tools<");
exports.early = 1;
require("./feed.mjs");
exports.late = 2;
console.log("tools>");
