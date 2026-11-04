const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
class Kit { ns = Object; }
const kits: Kit[] = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ ns: { values: () => ["fake"] } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.ns.values as any;
  noise();
  return f({ a: 1 }).join();
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
