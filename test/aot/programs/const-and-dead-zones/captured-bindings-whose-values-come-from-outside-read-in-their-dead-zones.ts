// Bindings of functions that closures hold, whose values come from outside the program, read in their dead zones.
interface Shape { x: number; inner: { v: number } }
function attempt(f: () => unknown): unknown { try { return f(); } catch (e) { return "threw " + (e as Error).constructor.name; } }
function given<T>(text: string): T { return JSON.parse(text) as T; }
function calledOnce(): string {
  const early = attempt(() => later.x);
  const peek = () => later.inner.v + count;
  const first = attempt(peek);
  const later: Shape = given<Shape>('{"x":1,"inner":{"v":2}}');
  const second = attempt(peek);
  const count: number = given<number>("3");
  return [early, first, second, peek()].join();
}
console.log(calledOnce());
function calledOften(k: number): string {
  const peek = () => later.x + k;
  const early = attempt(peek);
  if (k === 1) return String(early);
  const later: Shape = given<Shape>('{"x":' + k + ',"inner":{"v":2}}');
  return early + "," + peek();
}
for (let k = 0; k < 4; k++) console.log(calledOften(k));
function handsOut(): Array<() => unknown> {
  const out: Array<() => unknown> = [() => a.x, () => b, () => c.length, () => typeof a, () => { d = given<number>("8"); return d; }];
  if (given<boolean>("false")) return out;
  stash = out;
  lines.push(out.map(attempt).join());
  const a: Shape = given<Shape>('{"x":1,"inner":{"v":2}}');
  lines.push(out.map(attempt).join());
  const b: number = given<number>("2"), c: string = given<string>('"abc"');
  lines.push(out.map(attempt).join());
  let d: number = given<number>("4");
  lines.push(out.map(attempt).join(), String(d));
  return out;
}
let stash: Array<() => unknown> = [];
const lines: string[] = [];
handsOut();
console.log(lines.join("\n"), stash.map(attempt).join());
function inLoops(): string {
  let out = "";
  for (let i = 0; i < 3; i++) {
    const peek = (): number => w.x + i;
    out += attempt(peek) + ";";
    const w: Shape = given<Shape>('{"x":' + i * 2 + ',"inner":{"v":0}}');
    out += peek() + ";";
  }
  return out;
}
console.log(inLoops());
function leftByThrow(): unknown {
  let read: () => unknown = () => 0;
  try {
    read = () => value.x;
    if (given<boolean>("true")) throw new RangeError("midway");
    const value: Shape = given<Shape>('{"x":1,"inner":{"v":2}}');
    return value.x;
  } catch { return attempt(read); }
}
console.log(leftByThrow());
function parameters(a: number = attempt(() => c.x + 1) as number, c: Shape = given<Shape>('{"x":2,"inner":{"v":2}}')): string { return a + "," + c.x; }
console.log(parameters(), parameters(1));
export {};
