// A parameter is a variable like any other: once the function has set it to null, what the caller passed is collected while the function still runs.
// Prints what the compiler saves: objects that are collected earlier
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
console.log("a parameter: " + (parameter(make()) ? "collected" : "KEPT"));
console.log(sum > 0);
