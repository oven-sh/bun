import { value as a } from "./late-a.ts";
(globalThis as any).log.push("late-b runs");
export const value = a * 2;
