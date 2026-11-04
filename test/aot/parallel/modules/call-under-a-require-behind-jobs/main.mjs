// a.mjs calls import() of b.mjs while this require() loads it, and queues a job beside the call. The call is no part of the graph that the require() loads: its steps are jobs, so b.mjs runs behind the job that waits already, as in Node.js.
// `bun run` and `bun build --compile` run b.mjs first.
import { createRequire } from "node:module";
createRequire(import.meta.url)("./a.mjs");
/* Output:
job
b runs
b got
*/
