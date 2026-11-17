import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);
export const ask = () => load("./value.cjs");
