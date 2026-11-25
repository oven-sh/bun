// behind a listener the loop goes on: a timer that the file laid before it threw asks for the file
process.on("uncaughtException", (error) => console.log("caught:", error.message));
require("./flaky.cjs");
console.log("not reached");
