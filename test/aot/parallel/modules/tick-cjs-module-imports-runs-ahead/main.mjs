// between.mjs imports two CommonJS files, and the first of them queues the first tick of the process, which waits for the graph.
import "./between.mjs";
console.log("main runs");
