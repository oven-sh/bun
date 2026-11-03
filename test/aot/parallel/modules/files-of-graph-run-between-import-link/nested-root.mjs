import { value as outer } from "./nested-outer.cjs";
import { total as middle } from "./nested-middle.mjs";
globalThis.log.push("nested-root");
export const total = outer + middle;
