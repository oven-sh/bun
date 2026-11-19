import { late } from "./ring-a.ts";
(globalThis as any).log.push("ring-b runs");
export function early() { return "early"; }
export function value() { return late(); }
