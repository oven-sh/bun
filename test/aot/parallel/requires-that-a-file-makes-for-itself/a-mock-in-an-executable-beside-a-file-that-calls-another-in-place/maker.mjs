import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);
export const name = createRequire(import.meta.url)("./package.json").name;
