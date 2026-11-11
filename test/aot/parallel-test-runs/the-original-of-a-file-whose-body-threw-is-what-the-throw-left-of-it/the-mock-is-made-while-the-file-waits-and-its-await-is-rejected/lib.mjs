export const a = 1;
export function f() { return a; }
await new Promise((keep, refuse) => setTimeout(() => refuse(new Error("made up")), 5));
export const b = 2;
