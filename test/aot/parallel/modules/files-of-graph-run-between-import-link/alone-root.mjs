import { value as a } from "./alone-a.cjs";
import { total as middle } from "./alone-middle.mjs";
globalThis.log.push("alone-root");
export const total = a + middle;
