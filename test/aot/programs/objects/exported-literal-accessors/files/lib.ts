let kept = 1;
export const own = { w: 1, get g() { return 2; } };
export const only = { get g() { return 3; } };
export const pair = { get x() { return kept; }, set x(v: number) { kept = v * 2; } };
export function make(n: number) { return { get g() { return n; } }; }
export const annotated: { g: number } = { get g() { return 4; } };
