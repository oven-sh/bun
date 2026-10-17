// A field that `defineProperty` made an accessor on one path is not read on a path that does not read it.
declare const console: { log(...a: unknown[]): void };
interface P { x: number }
const held: P = { x: 0 } as any;
function sunk(c: boolean, d: boolean): number {
  const o: P = { x: 1 };
  if (c) Object.defineProperty(o as any, "x", { get: () => (console.log("the getter runs"), 2) });
  return d ? o.x : 0;
}
console.log(sunk(true, false));
