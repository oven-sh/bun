import { fromRequire } from "./requires-esm.cjs";
import { shared } from "./required-esm.mjs";
console.log("capture-root runs");
export const seen = [fromRequire, shared];
