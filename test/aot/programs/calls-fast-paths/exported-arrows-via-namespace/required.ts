let hookOfRequired: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfRequired = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfRequired(); return t; }
export const unrelated = (): number => 6;
