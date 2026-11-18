import { createRequire } from "node:module";
createRequire(import.meta.url)("./flaky.cjs");
console.log("not reached either");
