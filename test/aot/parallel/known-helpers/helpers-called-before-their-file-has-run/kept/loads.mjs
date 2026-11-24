import { createRequire } from "node:module";
const held = { load: createRequire(import.meta.url) };
held.load("./consumer.mjs");
console.log("kept loads");
