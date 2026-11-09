import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);
export const own = () => load("./value.cjs");
