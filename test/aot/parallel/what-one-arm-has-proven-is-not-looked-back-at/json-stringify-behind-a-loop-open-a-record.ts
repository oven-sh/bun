const unseen = (0, eval)("(x) => x");
type Kit = { ns: typeof JSON };
const kits: Kit[] = [{ ns: JSON }, { ns: JSON }, { ns: JSON }];
kits.push(unseen({ ns: { stringify: () => "fake" } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.ns.stringify as any;
  let k = 0; for (let j = 0; j < 2; j++) k += j; if (k !== 1) return k;
  return f({ a: 1 });
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
