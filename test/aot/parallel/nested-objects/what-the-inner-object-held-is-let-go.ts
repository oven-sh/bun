// An inner object that lies in the outer one holds references. Whoever stores another value to the field, or deletes the field, lets go of them, though the outer object lives on.
interface Leaf { v: number }
interface Inner { leaf: Leaf | null; n: number }
interface Outer { a: Inner | null; id: number }
const shared: Inner = { leaf: null, n: -1 };
const N = 20000;
function make(i: number): Outer { return { a: { leaf: { v: i }, n: i }, id: i }; }
async function run(name: string, letGo: (x: Outer) => void) {
  const kept: Outer[] = [];
  const leaves: WeakRef<Leaf>[] = [];
  for (let i = 0; i < N; i++) kept.push(make(i));
  for (const x of kept) leaves.push(new WeakRef(x.a!.leaf!));
  await new Promise(resolve => setTimeout(resolve, 0));
  Bun.gc(true);
  const aliveBefore = leaves.filter(leaf => leaf.deref() !== undefined).length;
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const x of kept) letGo(x);
  await new Promise(resolve => setTimeout(resolve, 0));
  Bun.gc(true);
  Bun.gc(true);
  const aliveAfter = leaves.filter(leaf => leaf.deref() !== undefined).length;
  let sum = 0;
  for (const x of kept) sum += x.id + (x.a ? x.a.n : 0);
  console.log(name, aliveBefore === N, aliveAfter < N / 10, sum);
}
await run("another object is stored", x => { x.a = shared; });
await run("null is stored", x => { x.a = null; });
await run("another object is stored by name", x => { (x as any)["a".slice(0)] = shared; });
await run("the field is deleted", x => { delete (x as any).a; });
await run("a fresh object is stored", x => { x.a = { leaf: null, n: 0 }; });
await run("the reference is stored over", x => { x.a!.leaf = null; });
await run("made, then the reference is stored over", x => { shared.n += Object.keys(x.a!).length - 2; x.a!.leaf = null; });
await run("made, then another object is stored", x => { shared.n += Object.keys(x.a!).length - 2; x.a = shared; });
