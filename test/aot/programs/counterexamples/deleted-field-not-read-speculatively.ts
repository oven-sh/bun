// A field that one path deletes is not read on that path.
declare const console: { log(...a: unknown[]): void };
interface P { x: number }
const held: P = { x: 0 } as any;
function f(c: boolean): number {
  const o: P = { x: 1 };
  if (c) delete (o as any).x;
  return c ? 0 : o.x;
}
console.log(f(true));
