import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const wanted = "beside a require of " + require("./file.cjs").other;
