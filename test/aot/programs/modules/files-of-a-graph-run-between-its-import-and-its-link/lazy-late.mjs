import { value as below } from "./lazy-below.cjs";
globalThis.log.push("lazy-late");
export const value = below + 1;
