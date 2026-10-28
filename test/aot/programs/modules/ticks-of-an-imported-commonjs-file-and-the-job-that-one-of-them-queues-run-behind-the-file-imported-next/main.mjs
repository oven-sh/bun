// first.cjs queues a tick, which queues a tick and a promise job, while the imports of this module are loaded. All three run behind second.cjs and ahead of this module. Plain Bun prints another output.
import "./first.cjs";
import "./second.cjs";
console.log("main runs");
