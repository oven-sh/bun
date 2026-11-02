import { value as inner } from "./nested-inner.cjs";
import { value as required } from "./nested-required.mjs";
globalThis.log.push("nested-middle");
export const total = inner + required;
