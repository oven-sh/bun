const unseen = (0, eval)("(x) => x");
class Kit { ns = JSON; }
const kits: Kit[] = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ ns: { stringify: () => "fake" } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.ns.stringify as any;
  
  return f({ a: 1 });
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
