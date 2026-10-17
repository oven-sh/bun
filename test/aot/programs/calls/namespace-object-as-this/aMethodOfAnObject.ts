let hookOfAMethodOfAnObject: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfAMethodOfAnObject = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfAMethodOfAnObject(); return t; }
const holder = { method(this: any): number { this.setHook(() => 7); return 6; } };
export const unrelated: (this: any) => number = holder.method;
