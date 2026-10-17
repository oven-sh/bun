let hookOfStoredTwice: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfStoredTwice = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfStoredTwice(); return t; }
export let unrelated = (): number => 3;
export function swap(): void { unrelated = () => 4; }
