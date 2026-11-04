// A parameter is a variable like any other: once the function has set it to null, what the caller passed is collected while the function still runs: also where the maker of the object is small enough to be copied into the caller.
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
}
let sum = 0;
function use(thing: Thing | null | undefined, more = 0): void {
  sum += (thing?.payload.length ?? 0) + more;
}
function parameter(x: Thing | null): boolean {
  const ref = new WeakRef(x!);
  use(x);
  use(x, 1);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
let other = 0;
function run(n: number): number { let t = n * 2 + 1; t = t % 7; t += n; t *= 3; t -= n; t |= 1; other += t; t = t * n + 5; other -= t % 3; other += n & t; const r = parameter(make()); other += 1; return r ? 0 : 1; }
let kept = 0;
kept += run(1);
kept += run(2);
kept += run(3);
console.log("kept", kept);
