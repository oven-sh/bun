import { early } from "./ring-b.ts";
(globalThis as any).log.push("ring-a runs " + early());
export const value = 10;
export function late() { return value; }
