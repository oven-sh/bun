import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
export const loaded = [load("./throws-3.cjs").value].length;
