let hookOfBehindFinally: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfBehindFinally = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfBehindFinally(); return t; }
export function unrelated(): number { return 4; }
