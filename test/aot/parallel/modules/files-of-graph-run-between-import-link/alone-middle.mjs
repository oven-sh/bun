import { value as b } from "./alone-b.cjs";
import { value as a } from "./alone-a.cjs";
globalThis.log.push("alone-middle");
export const total = a + b;
