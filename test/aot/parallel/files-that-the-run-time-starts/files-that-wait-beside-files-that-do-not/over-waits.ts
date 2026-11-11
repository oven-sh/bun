import { value as below } from "./waits.ts";
import { value as beside } from "./plain.ts";
(globalThis as any).log.push("over-waits runs");
export const value = below + beside;
