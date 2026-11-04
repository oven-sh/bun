const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
class Kit { ns = Math; }
function noise(): number { return unseen(0); }
function read(kit: Kit, i: number): unknown {
  const f = kit.ns.floor as any;
  
  return f(2.5) + f(3.5);
}
const run = unseen(read);
const one = new Kit();
let last: unknown;
for (let r = 0; r < 300; r++) last = run(one, r);
console.log(String(last), String(run(unseen({ ns: { floor: () => -1 } } as any), 1)));
