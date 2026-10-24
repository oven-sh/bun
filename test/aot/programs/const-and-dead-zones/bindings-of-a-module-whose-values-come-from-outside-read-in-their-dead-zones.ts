// Bindings of a module whose values come from outside the program, read in their dead zones.
interface Shape { x: number; inner: { v: number } }
function attempt(f: () => unknown): unknown { try { return f(); } catch (e) { return "threw " + (e as Error).constructor.name; } }
function given<T>(text: string): T { return JSON.parse(text) as T; }
const readers: Array<() => unknown> = [
  () => shape.x, () => shape.inner.v, () => n + 1, () => s.length, () => list[0], () => list.length, () => flag ? 1 : 2,
  () => maybe?.x, () => typeof shape, () => typeof n, () => shape, () => n, () => s, () => [shape, n], () => ({ shape }),
  () => { changing = given<Shape>('{"x":9,"inner":{"v":9}}'); return "stored"; }, () => changing.x, () => `${s}`, () => shape === undefined,
  () => shape == null, () => !shape, () => String(n), () => K.name, () => new K().x, () => K,
];
function all(): string { return readers.map(attempt).map(v => typeof v === "function" ? "function" : JSON.stringify(v)).join(" "); }
console.log(all());
const shape: Shape = given<Shape>('{"x":1,"inner":{"v":2}}');
console.log(all());
const n: number = given<number>("5");
const s: string = given<string>('"text"');
console.log(all());
const list: number[] = given<number[]>("[1,2]");
const flag: boolean = given<boolean>("true");
const maybe: Shape | undefined = given<Shape | undefined>('{"x":3,"inner":{"v":4}}');
console.log(all());
let changing: Shape = given<Shape>('{"x":5,"inner":{"v":6}}');
console.log(all());
class K { x: number = given<number>("7"); }
console.log(all());
export {};
