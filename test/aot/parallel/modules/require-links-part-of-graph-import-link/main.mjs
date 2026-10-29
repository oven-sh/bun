// A require links part of a graph between its import and its link.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import { createRequire } from "node:module";
import { base } from "./file.cjs";

const require = createRequire(import.meta.url);
console.log("main runs", base);

// The graphs are asked for, and before a job runs a part of each is required.
const graph = import("./root.mjs");
console.log("required", require("./part.mjs").value);
const namespace = await graph;
console.log("imported", namespace.total, namespace.name, Object.keys(namespace).join());

const deep = import("./deep-root.mjs");
console.log("required", require("./deep-middle.mjs").value);
console.log("imported", (await deep).total);

const two = [import("./first-of-two.mjs"), import("./second-of-two.mjs")];
console.log("required", require("./shared-by-two.mjs").value);
console.log("imported", (await Promise.all(two)).map(each => each.total).join());

const late = import("./late-root.mjs");
await null;
console.log("required", require("./late-part.mjs").value);
console.log("imported", (await late).total);
