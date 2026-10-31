import { value as third } from "./nested-third.cjs";
globalThis.log.push("nested-required");
export const value = third + 1;
