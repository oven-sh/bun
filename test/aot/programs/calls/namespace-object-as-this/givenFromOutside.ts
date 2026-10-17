let hookOfGivenFromOutside: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfGivenFromOutside = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfGivenFromOutside(); return t; }
export let unrelated: (this: any) => number = () => 2;
export function give(fn: (this: any) => number): void { unrelated = fn; }
