let hookOfReadsThis: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfReadsThis = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfReadsThis(); return t; }
export const unrelated = function (this: any): number { this.setHook(() => 7); return 1; };
