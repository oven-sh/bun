export type S = { kind: "a"; f: () => number } | { kind: "b"; f: number };
export const make = (k: boolean): S => k ? { kind: "a", f: () => 1 } : { kind: "b", f: 2 };
