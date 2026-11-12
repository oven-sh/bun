import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
const bag = { load() { return made("./bad.ts"); } };
export const other = typeof bag;
