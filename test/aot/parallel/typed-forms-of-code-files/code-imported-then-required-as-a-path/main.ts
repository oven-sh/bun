// A require() under type "file" of code that a statement imported gets the exports of the code: of a marked CommonJS file and of an ES module.
import { createRequire } from "node:module";
import marked, { other } from "./marked.cjs";
import five from "./module.mjs";
// @ts-ignore
const required: any = require("./marked.cjs", { type: "file" });
// @ts-ignore
const loaded: any = createRequire(import.meta.url)("./module.mjs", { type: "file" });
console.log(marked, other, typeof required, required.default, required.other, (globalThis as any).ran);
console.log(five, Object.keys(loaded).sort().join(), loaded.default, loaded.where);
