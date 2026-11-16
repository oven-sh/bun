import { createRequire } from "node:module";
if (process.env.MADE_UP_WARM) createRequire(import.meta.url)("./kit.cjs");
const { done } = await import("./begin.mjs");
console.log("end", done);
