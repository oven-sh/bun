import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try { require("./piece.mjs"); console.log("SELF RETURNED"); } catch (e) { console.log("SELF THREW", e.constructor.name); }
export const piece = 1;
