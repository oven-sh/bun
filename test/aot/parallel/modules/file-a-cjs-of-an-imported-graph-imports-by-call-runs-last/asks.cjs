import("./late.cjs").then(late => console.log("late is loaded:", late.default.name));
console.log("asks");
exports.name = "asks";
