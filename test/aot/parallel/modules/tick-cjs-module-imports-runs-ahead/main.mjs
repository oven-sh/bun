// between.mjs imports two CommonJS files, and the first of them queues the first tick of the process. The tick runs right behind that file, ahead of the second.
import "./between.mjs";
console.log("main runs");
