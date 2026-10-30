import { late } from "./lazy-file.cjs";
import { total as middle } from "./lazy-middle.mjs";
globalThis.log.push("lazy-root");
export const total = middle;
export { late };
