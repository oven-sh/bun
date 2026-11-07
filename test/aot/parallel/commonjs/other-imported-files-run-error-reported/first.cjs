module.exports = {};
process.on("uncaughtException", error => console.log("reported:", error.message));
console.log("first begins");
throw new Error("thrown by first");
