import { a } from "./a";
function attempt(read: () => unknown) { try { return JSON.stringify(read()); } catch (error) { return (error as Error).constructor.name; } }
export const early: string[] = [attempt(() => a)];
export const b: { name: string; sees: string } = { name: "b", sees: attempt(() => a.name) };
export function readA() { return a.name; }
