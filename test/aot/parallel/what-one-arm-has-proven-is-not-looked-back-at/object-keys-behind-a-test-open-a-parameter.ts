const unseen = (0, eval)("(x) => x");
class Kit { ns = Object; }
function noise(): number { return unseen(0); }
function read(kit: Kit, i: number): unknown {
  const f = kit.ns.keys as any;
  if (i < 0) return "never";
  return f({ a: 1 }).join();
}
const run = unseen(read);
const one = new Kit();
let last: unknown;
for (let r = 0; r < 300; r++) last = run(one, r);
console.log(String(last), String(run(unseen({ ns: { keys: () => ["fake"] } } as any), 1)));
