import * as a from "./cyc_a";
function probe(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
const value = [a][0];
export const early: string = probe(() => value.fromA) + ":" + typeof value.lookAtB;
export const fromB: string = "b";
export function late(): string { return value.fromA; }
