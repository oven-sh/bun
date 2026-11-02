import { value as below } from "./lazy-below.cjs";
globalThis.log.push("lazy-only-late");
export const value = below + 2;
