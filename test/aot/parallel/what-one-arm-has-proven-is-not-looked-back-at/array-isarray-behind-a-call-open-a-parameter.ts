const unseen = (0, eval)("(x) => x");
class Kit { ns = Array; }
function noise(): number { return unseen(0); }
function read(kit: Kit, i: number): unknown {
  const f = kit.ns.isArray as any;
  noise();
  return f([]);
}
const run = unseen(read);
const one = new Kit();
let last: unknown;
for (let r = 0; r < 300; r++) last = run(one, r);
console.log(String(last), String(run(unseen({ ns: { isArray: () => "fake" } } as any), 1)));
