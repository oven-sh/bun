import { early } from "./cycle_b";
export function asked(): string { return FLAG ? "on" : "off"; }
export function askedIf(): string { if (FLAG) return "then"; return "else"; }
export function askedValue(): boolean { return FLAG; }
export const first: string = early;
export const FLAG = false;
