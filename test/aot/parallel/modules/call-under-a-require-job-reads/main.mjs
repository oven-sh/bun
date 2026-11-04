// modules/call-under-a-require-behind-jobs as a value: the job that a.mjs queues beside its import() of b.mjs doesn't see what the body of b.mjs sets, as in Node.js.
// `bun run` and `bun build --compile` print 1.
import { createRequire } from "node:module";
createRequire(import.meta.url)("./a.mjs");
/* Output:
job sees undefined
b got
*/
