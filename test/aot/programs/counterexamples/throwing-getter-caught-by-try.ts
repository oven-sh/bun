// A field that `defineProperty` made a throwing accessor is read inside `try`.
declare const console: { log(...a: unknown[]): void };
const held: { x: number } = {} as any, define: any = Object.defineProperty;
function f(c: boolean): number {
  const o: typeof held = { x: 1 };
  try { if (c) define(o, "x", { get() { throw 1; } }); return o.x; } catch { return -1; }
}
try { console.log(f(true)); } catch { console.log("left the try"); }
