// As what-the-inner-object-held-is-let-go.ts, with births that outweigh everything else, so that the inner object lies in a room of the outer one: whoever stores another value to the field or makes the object lets go of what the room held.
class Leaf { v: number; constructor(v: number) { this.v = v; } }
// A field that holds objects of two layouts has no room for either, so the leaves have cells of their own.
class LeafWithName extends Leaf { name = "leaf"; }
interface Inner { leaf: Leaf | null; n: number }
interface Outer { a: Inner | null; id: number }
const shared: Inner = { leaf: new LeafWithName(0), n: -1 };
const N = 16000;
function make(i: number): Outer { return { a: { leaf: new Leaf(i), n: i }, id: i }; }
function makeAll(): Outer[] {
  const kept: Outer[] = [];
  for (let part = 0; part < 4; part++) for (let half = 0; half < 2; half++) for (let i = 0; i < N / 8; i++) kept.push(make(kept.length));
  return kept;
}
function storeAnother(kept: Outer[]) { for (let i = 0; i < kept.length; i++) kept[i].a = shared; }
function storeNull(kept: Outer[]) { for (let i = 0; i < kept.length; i++) kept[i].a = null; }
function storeFresh(kept: Outer[]) { for (let i = 0; i < kept.length; i++) kept[i].a = { leaf: null, n: 0 }; }
function storeOverTheReference(kept: Outer[]) { for (let i = 0; i < kept.length; i++) kept[i].a!.leaf = null; }
function makeThenStoreOver(kept: Outer[]) { for (let i = 0; i < kept.length; i++) { const x = kept[i]; shared.n += Object.keys(x.a!).length - 2; x.a!.leaf = null; } }
function makeThenStoreAnother(kept: Outer[]) { for (let i = 0; i < kept.length; i++) { const x = kept[i]; shared.n += Object.keys(x.a!).length - 2; x.a = null; } }
function leavesOf(kept: Outer[]): WeakRef<Leaf>[] { const leaves: WeakRef<Leaf>[] = []; for (let i = 0; i < kept.length; i++) leaves.push(new WeakRef(kept[i].a!.leaf!)); return leaves; }
function total(kept: Outer[]): number { let sum = 0; for (let i = 0; i < kept.length; i++) { const x = kept[i]; sum += x.id + (x.a ? x.a.n : 0); } return sum; }
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function run(name: string, letGo: (kept: Outer[]) => void) {
  const kept = makeAll();
  const leaves = leavesOf(kept);
  await pause();
  Bun.gc(true);
  const aliveBefore = leaves.filter(leaf => leaf.deref() !== undefined).length;
  await pause();
  letGo(kept);
  await pause();
  Bun.gc(true);
  Bun.gc(true);
  const aliveAfter = leaves.filter(leaf => leaf.deref() !== undefined).length;
  console.log(name, aliveBefore === N, aliveAfter < N / 10, total(kept));
}
await run("another object is stored", storeAnother);
await run("null is stored", storeNull);
await run("a fresh object is stored", storeFresh);
await run("the reference is stored over", storeOverTheReference);
await run("made, then the reference is stored over", makeThenStoreOver);
await run("made, then null is stored", makeThenStoreAnother);
