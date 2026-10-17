let hookOfRequiredTwice: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfRequiredTwice = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfRequiredTwice(); return t; }
export function unrelated(): number { return 3; }
