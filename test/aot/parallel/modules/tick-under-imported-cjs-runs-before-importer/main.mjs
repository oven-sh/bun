// A CommonJS file that the entry point imports requires two modules that wait for a process.nextTick(). The loader still has steps to take when the file has returned: the tick and the first jobs after it run before the importer, later jobs after it.
import "./file.cjs";
console.log("main runs");
