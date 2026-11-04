// Members whose text comes out of code that runs in the middle of the writing.
interface Point { x: number; y: number; label: string }
interface Shape { name: string; points: Point[]; tags: string[]; open?: boolean; weight: number | null; made: Date; inner?: Shape }

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function textOf(shape: Shape): string {
  return JSON.stringify(shape);
}

function textOfList(shapes: Shape[]): string {
  return JSON.stringify(shapes);
}

function lineOf(prefix: string, shape: Shape, suffix: string): string {
  let out = prefix;
  out += JSON.stringify(shape);
  out += suffix;
  out += JSON.stringify(shape.points);
  out += suffix;
  return out;
}

function make(depth: number, n: number): Shape {
  const points: Point[] = [];
  for (let i = 0; i < n; i++) points.push({ x: i * 1.5, y: -i, label: i % 3 ? "p" + i : "中" + i });
  const shape: Shape = { name: "shape" + depth, points, tags: ["a,", ",", "", "}", "\"", "\ud800"], weight: depth % 2 ? null : depth / 3, made: new Date(depth * 86400000) };
  if (depth % 3 === 0) shape.open = depth % 2 === 0;
  if (depth > 0) shape.inner = make(depth - 1, n);
  return shape;
}

let sum = 0;
for (let depth = 0; depth < 12; depth++) for (const n of [0, 1, 2, 7, 60, 400]) {
  const shape = make(depth, n);
  sum = (sum + hash(textOf(shape)) + hash(textOfList([shape, shape])) + hash(lineOf("[", shape, "]"))) >>> 0;
}
console.log(sum);

const odd = make(1, 2);
(odd.made as Date & { toJSON(): unknown }).toJSON = function () { return textOf(make(2, 3)); };
console.log(textOf(odd));
const stranger = make(0, 1) as Shape & { toJSON?: () => unknown };
stranger.toJSON = () => ({ replaced: textOf(make(1, 1)).length });
console.log(textOf(stranger), textOfList([stranger, make(0, 0)]));
const withGetter = make(0, 1);
Object.defineProperty(withGetter, "name", { enumerable: true, get() { return textOf(make(1, 1)); } });
console.log(hash(textOf(withGetter)), textOf(withGetter).length);
const big = make(0, 0) as unknown as { weight: unknown };
big.weight = 10n;
try { console.log(textOf(big as unknown as Shape)); } catch (error) { console.log((error as Error).constructor.name); }
const wrongKinds = make(0, 1) as unknown as Record<string, unknown>;
for (const value of [undefined, () => 1, Symbol("s"), new Number(-0), new String("boxed"), new Boolean(false), [1, , 3], { toJSON() { return undefined; } }, -0, 1e21, "text"]) {
  for (const key of ["name", "points", "tags", "open", "weight", "made", "inner"]) {
    const kept = wrongKinds[key];
    wrongKinds[key] = value;
    let text: string;
    try { text = textOf(wrongKinds as unknown as Shape) ?? "undefined"; } catch (error) { text = (error as Error).constructor.name; }
    console.log(key, typeof value, hash(text), text.length);
    wrongKinds[key] = kept;
  }
}
const cyclic = make(1, 0);
cyclic.inner!.inner = cyclic;
try { console.log(textOf(cyclic)); } catch (error) { console.log((error as Error).constructor.name); }
const holes: Point[] = [];
holes[3] = { x: 1, y: 2, label: "l" };
const withHoles = make(0, 0);
withHoles.points = holes;
console.log(textOf(withHoles));
delete (withHoles as Partial<Shape>).name;
(withHoles as Shape & { extra: number }).extra = 5;
console.log(textOf(withHoles));
