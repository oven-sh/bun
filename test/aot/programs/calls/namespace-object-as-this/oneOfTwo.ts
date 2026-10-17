let hookOfOneOfTwo: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfOneOfTwo = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfOneOfTwo(); return t; }
export let unrelated: (this: any) => number = () => 4;
export function swap(): void { unrelated = function (this: any): number { this.setHook(() => 7); return 5; }; }
