// The idiom of a leak test: `x = null; gc(); expect(ref.deref()).toBeUndefined()`. An object whose last name was a local that the function has set to null or undefined is collected while that function still runs.
// Prints what the compiler saves: objects that are collected earlier
// Todo under ASAN: Not every time: row 3695: `x = null` prints KEPT: red in CI's round 7, green in round 6 on the same engine
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
}
let sum = 0;
function use(thing: Thing | null | undefined, more = 0): void {
  sum += (thing?.payload.length ?? 0) + more;
}
const finalized = new Set<string>();
const registry = new FinalizationRegistry<string>(name => finalized.add(name));
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const lines: string[] = [];
const say = (form: string, gone: boolean) => lines.push(`${form}: ${gone ? "collected" : "KEPT"}`);

function toNull(): boolean {
  let x: Thing | null = make();
  const ref = new WeakRef(x);
  use(x);
  use(x, 1);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function toUndefined(): boolean {
  let x: Thing | undefined = make();
  const ref = new WeakRef(x);
  use(x);
  use(x, 1);
  x = undefined;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function toVoid(): boolean {
  let x: Thing | undefined = make();
  const ref = new WeakRef(x);
  use(x);
  x = void 0;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function destructured(): boolean {
  let { x, other }: { x: Thing | null; other: number } = { x: make(), other: 1 };
  const ref = new WeakRef(x!);
  use(x, other);
  use(x, 1);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function fromList(): boolean {
  let [x]: (Thing | null)[] = [make()];
  const ref = new WeakRef(x!);
  use(x);
  use(x, 1);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function two(): boolean {
  let x: Thing | undefined = make();
  const ref = new WeakRef(x);
  let holder: { held: Thing } | undefined = { held: x };
  use(holder.held);
  use(x, 1);
  x = undefined;
  holder = undefined;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function amongMany(): boolean {
  const a = make(), b = make(), c = make(), d = make(), e = make(), f = make(), g = make(), h = make(), i = make(), j = make();
  let x: Thing | null = make();
  const ref = new WeakRef(x);
  use(x, a.id + b.id + c.id + d.id + e.id);
  use(x, f.id + g.id + h.id + i.id + j.id);
  x = null;
  Bun.gc(true);
  const gone = ref.deref() === undefined;
  use(a); use(b); use(c); use(d); use(e); use(f); use(g); use(h); use(i); use(j);
  return gone;
}
function registered(name: string): void {
  let x: Thing | null = make();
  registry.register(x, name);
  use(x);
  use(x, 1);
  x = null;
  Bun.gc(true);
}
async function asyncBeforeAwait(): Promise<boolean> {
  let x: Thing | null = make();
  const ref = new WeakRef(x);
  use(x);
  use(x, 1);
  x = null;
  Bun.gc(true);
  const gone = ref.deref() === undefined;
  await turn();
  return gone;
}
async function asyncAcrossAwait(): Promise<boolean> {
  let x: Thing | undefined = make();
  const ref = new WeakRef(x);
  use(x);
  use(x, 1);
  x = undefined;
  await turn();
  Bun.gc(true);
  return ref.deref() === undefined;
}
function* generatorAcrossYield(): Generator<WeakRef<Thing>, void> {
  let x: Thing | undefined = make();
  const ref = new WeakRef(x);
  use(x);
  use(x, 1);
  x = undefined;
  yield ref;
}

say("x = null", toNull());
say("x = undefined", toUndefined());
say("x = void 0", toVoid());
say("a destructured local", destructured());
say("a local out of a list", fromList());
say("a local and what holds it", two());
say("among many that live on", amongMany());
say("async, before the first await", await asyncBeforeAwait());
say("async, collected behind the await", await asyncAcrossAwait());
{
  const iterator = generatorAcrossYield();
  const ref = iterator.next().value as WeakRef<Thing>;
  Bun.gc(true);
  say("a generator that waits at a yield", ref.deref() === undefined);
  iterator.next();
}
registered("plain");
await turn();
say("FinalizationRegistry", finalized.has("plain"));
console.log(lines.join("\n"));
console.log(sum > 0);
