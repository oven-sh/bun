import { value } from "./lazy-late.mjs";
globalThis.log.push("lazy-middle");
export const total = value + 1;
