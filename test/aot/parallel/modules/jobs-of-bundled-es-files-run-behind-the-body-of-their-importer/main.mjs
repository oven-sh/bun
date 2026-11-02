// A file that a bundler made is an ES module. A graph of ES modules without a top-level await is evaluated in one go: what a file queues runs behind the body of whoever imports it.
// Each of these files imports nothing itself and asks for what its helper wraps, so its first request is a require of a CommonJS record that has the file's own display path.
import { x as x0 } from "./helper-of-bun.mjs";
import { x as x1 } from "./helper-of-esbuild.mjs";
import { x as x2 } from "./helper-for-es-modules.mjs";
import { x as x3 } from "./queue-microtask.mjs";
import { x as x4 } from "./next-tick.mjs";
import { x as x5 } from "./behind-an-await.mjs";
import { x as x6 } from "./queued-by-the-inner-module.mjs";
import { x as x7 } from "./inner-module-asked-for-in-the-job.mjs";
import { x as x8 } from "./asked-for-in-a-branch-never-taken.mjs";
console.log("body: main", x0 + x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8);
Promise.resolve().then(() => console.log("job: main"));
