import { createRequire } from "node:module";
const load = Date.now() > 0 ? createRequire(import.meta.url) : Math.abs;
console.log(typeof load("node:os").cpus);
