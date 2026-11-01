import("./late.mjs").then(late => console.log("late is loaded:", late.name));
console.log("asks");
exports.name = "asks";
