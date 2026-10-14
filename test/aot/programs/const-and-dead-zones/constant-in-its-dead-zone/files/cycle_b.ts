import { asked, askedIf, askedValue } from "./cycle_a";
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
export const early: string = [asked, askedIf, askedValue].map(attempt).join();
export function later(): string { return [asked, askedIf, askedValue].map(attempt).join(); }
