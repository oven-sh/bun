import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const early = require(process.argv[99] ?? "./data.json");
