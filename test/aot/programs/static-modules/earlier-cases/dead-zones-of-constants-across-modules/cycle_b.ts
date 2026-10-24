import { asked, askedIf, askedValue } from "./cycle_a";
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
// This module is evaluated first: cycle_a's constants are in their dead zone.
export const early: string = [asked, askedIf, askedValue].map(attempt).join();
export function later(): string { return [asked, askedIf, askedValue].map(attempt).join(); }
