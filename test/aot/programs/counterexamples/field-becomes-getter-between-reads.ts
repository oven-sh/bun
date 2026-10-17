// Two reads of a field run its getter twice when `defineProperty` made it an accessor on one path.
declare const console: { log(...a: unknown[]): void };
interface P { x: number }
const held: P = { x: 0 } as any;
let n = 0;
function f(c: boolean, k: string) { const o: P = { x: 1 }; if (c) Object.defineProperty(o as any, k, { get: () => ++n }); return o.x * 10 + o.x; }
console.log(f(true, "x"), n);
