// Two imported CommonJS files queue a tick each. Only the first tick of the process runs right behind its file: the second waits until the jobs that load and run the graph are through.
import "./first.cjs";
import "./between.cjs";
import "./second.cjs";
import "./last.cjs";
console.log("main runs");
