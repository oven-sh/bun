// An imported CommonJS file registers a reaction on a promise and queues the first tick of the process. The tick's callback registers a second reaction on the same promise: the two run in the order in which they were registered.
import "./file.cjs";
console.log("importer runs");
