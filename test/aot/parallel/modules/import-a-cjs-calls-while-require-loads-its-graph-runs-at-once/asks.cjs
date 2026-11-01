import("./late.mjs").then(late => console.log("late is loaded:", late.name));
Promise.resolve().then(() => console.log("job of asks"));
console.log("asks");
exports.name = "asks";
