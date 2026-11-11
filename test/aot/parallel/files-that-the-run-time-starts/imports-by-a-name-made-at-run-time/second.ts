import { value as below } from "./first.ts";
(globalThis as any).log.push("second runs over " + below);
export const value = below + 1;
export function more() { return value + 1; }
