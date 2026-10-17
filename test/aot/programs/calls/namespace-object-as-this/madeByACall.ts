let hookOfMadeByACall: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfMadeByACall = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfMadeByACall(); return t; }
function make(): (this: any) => number { return function (this: any): number { this.setHook(() => 7); return 3; }; }
export const unrelated = make();
