const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
class Kit { ns = String; }
const kits: Kit[] = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ ns: { fromCharCode: () => "?" } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.ns.fromCharCode as any;
  let k = 0; for (let j = 0; j < 2; j++) k += j; if (k !== 1) return k;
  return f(65) + f(66);
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
