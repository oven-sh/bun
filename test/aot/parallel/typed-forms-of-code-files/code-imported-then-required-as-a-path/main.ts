// A require() under type "file" of code that a statement imported gets the exports of the code: of a marked CommonJS file and of an ES module.
import { createRequire } from "node:module";
import marked, { other } from "./marked.cjs";
import five from "./module.mjs";
const required = require("./marked.cjs", { type: "file" });
const loaded = createRequire(import.meta.url)("./module.mjs", { type: "file" });
console.log(marked, other, typeof required, required.default, required.other, globalThis.ran);
console.log(five, Object.keys(loaded).sort().join(), loaded.default, loaded.where);
