import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
globalThis.hook = () => { try { return load("./outside.mjs").seen; } catch (error) { return error.constructor.name; } };
const said = await import("./first.mjs").then(() => "fulfilled", error => "rejected " + error.message);
console.log("first:", said);
console.log("second:", await import("./second.mjs").then(it => "fulfilled " + it.ok, error => "rejected " + error.message));
