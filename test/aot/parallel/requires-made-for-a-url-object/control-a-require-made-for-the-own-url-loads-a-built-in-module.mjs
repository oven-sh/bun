import { createRequire } from "node:module";
const place = new URL(import.meta.url);
const load = createRequire(place);
console.log(typeof load("node:path").join, typeof load("node:os").platform);
