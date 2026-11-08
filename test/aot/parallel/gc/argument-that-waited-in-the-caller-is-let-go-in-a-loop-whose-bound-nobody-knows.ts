// `f(make(), other())` in a loop that stays a loop: what make() returned waits in the caller while other() runs. Once f has set its parameter to null nothing names the object, and it is collected while f still runs.
// The loop of three turns in argument-that-waited-in-the-caller-is-let-go-by-the-callee.ts is written out into straight code and says nothing of a loop: here nobody knows the bound.
// Prints what the compiler saves: objects that are collected earlier
// Skip on win32 x64: some lines print that the object is kept: native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
}
let sum = 0;
function use(thing: Thing | null | undefined, more: number): void {
  sum += (thing?.payload.length ?? 0) + more;
}
function other(): number {
  sum += made;
  return sum & 1;
}

function first(x: Thing | null, more: number): boolean {
  const ref = new WeakRef(x!);
  use(x, 0);
  use(x, more);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
const turns: number = JSON.parse("3");
function inLoop(): boolean {
  let all = true;
  for (let i = 0; i < turns; i++) all = first(make(), other() + i) && all;
  return all;
}
console.log(`in a loop whose bound nobody knows: ${inLoop() ? "collected" : "KEPT"}`);
