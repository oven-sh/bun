// As reaction-registered-by-tick-after-imported-cjs, but the tick's callback calls queueMicrotask(): the reaction that the file registered runs before that job.
import "./file.cjs";
console.log("importer runs");
