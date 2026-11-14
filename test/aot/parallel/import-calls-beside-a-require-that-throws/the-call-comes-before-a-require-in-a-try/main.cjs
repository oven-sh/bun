// import() of the file is called, then require() runs the file, which throws into a handler: the call's job runs the file again
import("./flaky.cjs").then((answer) => console.log("imported:", answer.default.value), (error) => console.log("rejected:", error.message));
try { console.log("required:", require("./flaky.cjs").value); } catch (error) { console.log("caught:", error.message); }
console.log("the body goes on", globalThis.runs);
