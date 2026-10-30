// A module imports two CommonJS files. The first registers a reaction on a promise and queues the first tick of the process, whose callback registers a second reaction on the same promise: the tick runs before the second file, and the reactions in the order in which they were registered.
import "./between.mjs";
console.log("main runs");
