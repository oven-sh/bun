let hookOfAHandler: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfAHandler = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfAHandler(); return t; }
export function unrelated(): number { return 0; }
