// An object that escapes in one branch only is allocated in that branch.
declare const console: { log(...a: unknown[]): void };
interface P { x: number; y: number }
let kept: P | undefined;
function f(c: boolean, n: number): number {
  const o: P = { x: n, y: n + 1 };
  if (c) kept = o;
  return o.x * 10 + o.y;
}
let s = 0;
for (let i = 0; i < 4; i++) s += f(i === 3, i);
console.log(s, kept!.x);
