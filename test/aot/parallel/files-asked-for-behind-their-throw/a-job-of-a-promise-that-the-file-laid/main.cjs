// behind a listener the jobs go on: a reaction that the file laid before it threw asks for the file, and a rejection handler asks once more
process.on("uncaughtException", (error) => console.log("caught:", error.message));
require("./flaky.cjs");
console.log("not reached");
