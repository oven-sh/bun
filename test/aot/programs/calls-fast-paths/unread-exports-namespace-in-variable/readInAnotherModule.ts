let hookOfReadInAnotherModule: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfReadInAnotherModule = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfReadInAnotherModule(); return t; }
export function unrelated(): number { return 4; }
