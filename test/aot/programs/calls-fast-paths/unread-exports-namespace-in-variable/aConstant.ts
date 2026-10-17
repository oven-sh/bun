let hookOfAConstant: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfAConstant = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfAConstant(); return t; }
export function unrelated(): number { return 0; }
