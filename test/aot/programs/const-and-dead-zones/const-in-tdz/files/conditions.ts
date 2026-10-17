function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
function value(): boolean { return K; }
function inIf(): string { if (K) return "then"; return "else"; }
function inCond(): string { return K ? "yes" : "no"; }
function inAnd(): unknown { return K && "right"; }
function inOr(): unknown { return Z || "right"; }
function inNot(): boolean { return !K; }
function inEq(): boolean { return N === 1; }
function inWhile(): string { while (K) return "looped"; return "not"; }
function inNested(): string { return (K && N === 1) ? "both" : "not both"; }
const all = [value, inIf, inCond, inAnd, inOr, inNot, inEq, inWhile, inNested];
export const early: string = all.map(attempt).join();
const K = true, N = 1, Z = 0;
export const later: string = all.map(attempt).join();
