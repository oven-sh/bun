import { createRequire } from "node:module";
export const early = 1;
say(typeof createRequire(import.meta.url)("./target.mjs"));
throw new Error("no");
