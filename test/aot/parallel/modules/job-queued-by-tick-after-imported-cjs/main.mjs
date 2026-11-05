// An imported CommonJS file queues jobs and a tick. A job that the tick's callback queues runs after the jobs that the file queued before it.
import "./file.cjs";
console.log("importer runs");
