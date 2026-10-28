let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; helper(); }
function helper(): void { onlyTheSetterCallsThis++; }
let onlyTheSetterCallsThis = 0;
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 5; }
export function calledAsAMethod(x: number): number { return x + 1; }
export const constant = 11;
export let counter = 0;
export function count(): void { counter++; }
