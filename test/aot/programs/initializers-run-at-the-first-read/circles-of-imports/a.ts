import { b, early as earlyB } from "./b";
export const early: string[] = [];
function attempt(read: () => unknown) { try { return JSON.stringify(read()); } catch (error) { return (error as Error).constructor.name; } }
early.push(attempt(() => b));
export const a: { name: string; sees: string; log: string[] } = { name: "a", sees: attempt(() => b.name), log: earlyB };
export function readB() { return b.name; }
