// An imported CommonJS file queues no job and the first tick of the process, and the tick's callback begins a chain of jobs: the importer runs behind the link behind which it runs under plain Bun.
import "./file.cjs";
console.log("importer runs");
