import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
globalThis.hook = () => load("./outside.mjs").seen;
const said = await import("./first.mjs").then(() => "fulfilled", error => "rejected " + error.message);
console.log("first:", said);
console.log("behind:", load("./outside.mjs").again());
