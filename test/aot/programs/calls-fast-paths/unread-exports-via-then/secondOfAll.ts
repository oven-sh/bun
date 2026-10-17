let hookOfSecondOfAll: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfSecondOfAll = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfSecondOfAll(); return t; }
export function unrelated(): number { return 21; }
