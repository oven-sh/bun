// A function that may be entered again from below itself makes an object through a small function, which is copied into it, lets it wait while another argument is computed, and hands it to a callee that sets its parameter to null and runs on.
// Prints what the compiler saves: objects that are collected earlier
// Skip on win32 x64: some lines print that the object is kept: native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: [made, made + 1, made + 2] };
}
let sum = 0;
function use(thing: Thing | null, more: number): void {
  const list = thing?.payload ?? [];
  for (const n of list) sum += n % 7 === 0 ? n * 2 : n;
  sum += more;
}
function other(): number {
  sum += made;
  return sum & 1;
}
function drain(x: Thing | null, more: number): boolean {
  const ref = new WeakRef(x!);
  use(x, 0);
  use(x, more);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function entersItself(depth: number): boolean {
  if (depth > 0) return entersItself(depth - 1);
  const gone = drain(make(), other());
  use(null, other());
  return gone;
}
function entersItselfWithoutWaiting(depth: number): boolean {
  if (depth > 0) return entersItselfWithoutWaiting(depth - 1);
  const gone = drain(make(), 0);
  use(null, other());
  return gone;
}
const say = (form: string, gone: boolean) => console.log(`${form}: ${gone ? "collected" : "KEPT"}`);
say("the object waits while another argument is computed", entersItself(other() + 1));
say("the object is handed over at once", entersItselfWithoutWaiting(other() + 1));
console.log(sum > 0);
