const unseen = (0, eval)("(x) => x");
type Kit = { ns: typeof Object };
const kits: Kit[] = [{ ns: Object }, { ns: Object }, { ns: Object }];
kits.push(unseen({ ns: { keys: () => ["fake"] } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.ns.keys as any;
  noise();
  return f({ a: 1 }).join();
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
