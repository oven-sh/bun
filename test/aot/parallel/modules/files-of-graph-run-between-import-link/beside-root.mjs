import { total as middle } from "./beside-middle.mjs";
import { value as a } from "./beside-a.cjs";
globalThis.log.push("beside-root");
export const total = a + middle;
