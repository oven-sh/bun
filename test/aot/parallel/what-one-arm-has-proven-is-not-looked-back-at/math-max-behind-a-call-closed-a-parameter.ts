const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
class Kit { ns = Math; }
function noise(): number { return unseen(0); }
function read(kit: Kit, i: number): unknown {
  const f = kit.ns.max as any;
  noise();
  return f(1, 2);
}
const run = unseen(read);
const one = new Kit();
let last: unknown;
for (let r = 0; r < 300; r++) last = run(one, r);
console.log(String(last), String(run(unseen({ ns: { max: () => 0 } } as any), 1)));
