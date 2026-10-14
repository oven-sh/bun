// A local object's allocation is removed although objects created by untyped code can have the same type.
declare const console: { log(...a: unknown[]): void };
interface Q { x: number }
const foreign: Q = { x: 0 } as any;
function g(n: number): number { const o: Q = { x: n }; return o.x + 1; }
console.log(g(1), foreign.x);
