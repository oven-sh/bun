import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const loaded = (() => require("./throws-1.cjs"))();
