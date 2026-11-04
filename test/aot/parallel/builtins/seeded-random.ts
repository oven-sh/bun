import { setRandomSeed } from "bun:jsc";
const show = (x: number): number => Math.floor(x * 1e9);
function roll(use: boolean): number {
  const r = Math.random();
  return use ? show(r) : -1;
}
function ignore(x: number, y: number): number {
  return y;
}
interface Point {
  x: number;
  y: number;
}
class Holder {
  inner: Point;
  constructor(inner: Point) {
    this.inner = inner;
  }
}
function drawThenRead(holder: Holder): number {
  const r = Math.random();
  const inner = holder.inner;
  return inner.x + inner.y + show(r);
}
const call = new Function("f", "holder", process.argv[9] ?? "return f(holder)");
const lines: string[] = [];
setRandomSeed(42);
lines.push([roll(false), roll(true), roll(false), show(Math.random())].join(" "));
setRandomSeed(42);
for (let i = 0; i < 5; i++) Math.random();
lines.push(String(show(Math.random())));
setRandomSeed(42);
Math.random();
void Math.random();
const five = (Math.random(), 5);
const held = { r: Math.random(), k: 1 };
lines.push([five, held.k, ignore(Math.random(), 2), show(Math.random())].join(" "));
for (const inner of [{ x: 1, y: 2 }, Object.create({ x: 1, y: 2 }), new Proxy({ x: 1, y: 2 }, {}), Object.assign([], { x: 1, y: 2 })]) {
  setRandomSeed(42);
  lines.push([call(drawThenRead, new Holder(inner)), show(Math.random())].join(" "));
}
console.log(lines.join("\n"));
