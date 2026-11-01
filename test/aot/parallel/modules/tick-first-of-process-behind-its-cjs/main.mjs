// The entry point imports CommonJS files, packages and ES modules. One file queues the first tick of the process, a job and an immediate: the tick runs right behind the file, ahead of the files behind it.
import "early";
import "./queues.cjs";
import "./module.mjs";
import "late";
import "./last.cjs";
console.log("main runs");
