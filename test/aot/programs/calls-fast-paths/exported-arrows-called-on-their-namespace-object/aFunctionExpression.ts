let hookOfAFunctionExpression: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfAFunctionExpression = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfAFunctionExpression(); return t; }
export const unrelated = function (): number { return 2; };
