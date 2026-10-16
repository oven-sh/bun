let moreHook: () => number = () => 1;
export function setMoreHook(fn: () => number): void { moreHook = fn; }
export function callMoreHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += moreHook(); return t; }
export function other(): number { return 6; }
export const word = "more";
