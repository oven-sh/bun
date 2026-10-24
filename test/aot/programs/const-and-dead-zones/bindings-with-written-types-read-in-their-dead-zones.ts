// Bindings with written types, read in their dead zones.
function attempt(f: () => unknown): unknown { try { return f(); } catch (e) { return "threw " + (e as Error).constructor.name; } }
interface Shape { x: number; inner: { v: number } }
class Point { x = 1; y = 2; }
enum Color { Red = 1, Green }
console.log(attempt(() => n + 1), attempt(() => s.length), attempt(() => b ? 1 : 2), attempt(() => big + 1n), attempt(() => shape.inner.v), attempt(() => point.x + point.y), attempt(() => color + 1), attempt(() => list[0] + list.length), attempt(() => tuple[1].length), attempt(() => fn(1)), attempt(() => opt?.x), attempt(() => u), attempt(() => typeof n), attempt(() => { n2 = 5; return "stored"; }));
const n: number = 5;
const s: string = "text";
const b: boolean = true;
const big: bigint = 5n;
const shape: Shape = { x: 1, inner: { v: 2 } };
const point: Point = new Point();
const color: Color = Color.Green;
const list: number[] = [1, 2];
const tuple: [number, string] = [1, "a"];
const fn: (v: number) => number = v => v + 1;
const opt: Shape | undefined = undefined;
const u: undefined = undefined;
let n2: number = 1;
console.log(n + s.length + shape.inner.v + point.x + color + list[0] + tuple[1].length + fn(1) + n2, b, big, opt, u);
function inner(k: number): string {
  const read = (): number => m * 2 + d + t.length + o.inner.v;
  const early = attempt(read);
  if (k) return String(early);
  const m: number = 3, d: number = 0.5, t: string = "ab", o: Shape = { x: 1, inner: { v: 4 } };
  return early + "," + read();
}
console.log(inner(0), inner(1));
function loop(): string {
  let out = "";
  for (let i = 0; i < 3; i++) {
    const peek = (): number => w + i;
    out += attempt(peek) + ";";
    const w: number = i * 2;
    out += peek() + ";";
  }
  return out;
}
console.log(loop());
class Holder { static early = attempt(() => Holder.late + 1); static late: number = 5; static obj: Shape = { x: 1, inner: { v: attempt(() => Holder.after.x) as number } }; static after: Point = new Point(); }
console.log(Holder.early, Holder.late, Holder.obj.inner.v);
function params(a: number = attempt(() => c + 1) as number, c: number = 2): string { return a + "," + c; }
console.log(params(), params(1));
export {};
