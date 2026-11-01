// A rest list or a literal that is made for one call has no name: behind the call nothing can read it. What it held is collected while the function that made the call still runs: once the last name is set to null or its block has ended.
// Prints what the compiler saves: objects that are collected earlier
// Alone: what is let go of goes by which bodies are copied into which, and that by all that the executable holds
// Todo on win32 x64: Not every time: row 3517: some lines print that the object is kept: native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
// Flags: --aot-disable=InlineCalls
type Thing = { id: number; payload: number[] };
let made = 0;
let watched: WeakRef<Thing> | undefined;
function make(): Thing {
  const thing = { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
  watched = new WeakRef(thing);
  return thing;
}
let sum = 0;
function mix(seed: number, ...rest: unknown[]): number {
  let more = rest.length;
  for (const value of rest) more += typeof value === "object" ? 1 : 2;
  return (seed * 31 + more) | 0;
}
function reads(box: { held: Thing }): number {
  return box.held.id;
}
const lines: string[] = [];
function report(what: string, ref: WeakRef<Thing> = watched!): void {
  lines.push(`${what}: ${ref.deref() === undefined ? "collected" : "KEPT"}`);
}
function restListThenNull(): void {
  let x: Thing | null = make();
  const ref = new WeakRef(x);
  sum = mix(sum, x, x, x);
  x = null;
  Bun.gc(true);
  report("a rest list, then x = null", ref);
}
function literalThenNull(): void {
  let x: Thing | null = make();
  const ref = new WeakRef(x);
  sum += reads({ held: x });
  x = null;
  Bun.gc(true);
  report("a literal, then x = null", ref);
}
function constantOfBlock(): void {
  {
    const x = make();
    sum = mix(sum, x);
  }
  Bun.gc(true);
  report("a constant of a block that has ended");
}
class Holder {
  field = 1;
  method(): void {
    sum = mix(sum, make(), this.field);
    Bun.gc(true);
    report("a temporary in a rest list, in a method");
  }
}
restListThenNull();
literalThenNull();
constantOfBlock();
new Holder().method();
console.log(lines.join("\n"));
console.log(sum);
