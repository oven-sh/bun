const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
class Kit { ns = Number; }
const kits: Kit[] = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ ns: { parseFloat: () => -1 } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.ns.parseFloat as any;
  noise();
  return f("2.5");
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
