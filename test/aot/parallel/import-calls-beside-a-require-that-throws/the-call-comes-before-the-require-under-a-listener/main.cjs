// import() of the file is called before require() of it runs the file and throws: behind a listener the call's job runs the file again
// Which comes first, the listener or the call, is not settled in plain Bun: its loader reads files on other threads. So the lines are sorted.
const lines = [];
process.on("uncaughtException", (error) => lines.push("caught: " + error.message));
process.on("beforeExit", () => { console.log(lines.sort().join("\n")); lines.length = 0; });
import("./flaky.cjs").then((answer) => lines.push("imported: " + answer.default.value), (error) => lines.push("rejected: " + error.message));
require("./flaky.cjs");
console.log("not reached");
