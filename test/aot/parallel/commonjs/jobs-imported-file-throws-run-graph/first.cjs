module.exports = {};
process.on("uncaughtException", error => console.log("reported:", error.message));
console.log("first begins");
Promise.resolve().then(() => console.log("job of first"));
import("./module.mjs").then(
  () => console.log("module is imported"),
  error => console.log("module failed:", error.message),
);
throw new Error("thrown by first");
