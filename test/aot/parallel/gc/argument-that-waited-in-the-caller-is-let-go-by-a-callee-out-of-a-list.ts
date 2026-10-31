// The functions that set their parameter to null are also values in a list, so a call may find out only at run time which of them it calls. What the caller passed is collected all the same while the callee still runs.
// Prints what the compiler saves: objects that are collected earlier
// Todo on win32 x64: Not every time: row 3517: some lines print that the object is kept: native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
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
const lines: string[] = [];
const say = (form: string, gone: boolean) => lines.push(`${form}: ${gone ? "collected" : "KEPT"}`);

function toNull(x: Thing | null, more: number): boolean {
  const ref = new WeakRef(x!);
  use(x, 0);
  use(x, more);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function toUndefined(x: Thing | undefined, more: number): boolean {
  const ref = new WeakRef(x!);
  use(x, 0);
  use(x, more);
  x = undefined;
  Bun.gc(true);
  return ref.deref() === undefined;
}
const table = [toNull, toUndefined];
function outOfList(i: number): boolean {
  return table[i](make() as any, other());
}
function outOfListAndGoesOn(i: number): boolean {
  const gone = table[i](make() as any, other());
  use(null, other());
  return gone;
}

say("by name", toNull(make(), 0));
say("by name, across a call", toNull(make(), other()));
say("out of the list, the first", outOfList(other() & 0));
say("out of the list, the second", outOfList(1 | other()));
say("out of the list, in a function that goes on", outOfListAndGoesOn(other() & 0));
say("call", toUndefined.call(undefined, make(), other()));
say("apply", toNull.apply(undefined, [make(), other()]));
console.log(lines.join("\n"));
console.log(sum > 0);
