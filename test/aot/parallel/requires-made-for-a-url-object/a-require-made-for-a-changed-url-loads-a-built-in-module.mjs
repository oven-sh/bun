import { createRequire } from "node:module";
const place = new URL(import.meta.url);
place.pathname = "/nowhere/at/all/start.mjs";
const load = createRequire(place);
console.log(typeof load("node:path").join, typeof load("node:os").platform);
