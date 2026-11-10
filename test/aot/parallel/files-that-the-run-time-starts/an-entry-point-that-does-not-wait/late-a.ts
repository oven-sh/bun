import { value as below } from "./below.ts";
(globalThis as any).log.push("late-a runs");
export const value = below * 2;
