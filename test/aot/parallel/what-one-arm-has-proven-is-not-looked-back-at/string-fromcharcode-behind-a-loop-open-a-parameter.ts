const unseen = (0, eval)("(x) => x");
class Kit { ns = String; }
function noise(): number { return unseen(0); }
function read(kit: Kit, i: number): unknown {
  const f = kit.ns.fromCharCode as any;
  let k = 0; for (let j = 0; j < 2; j++) k += j; if (k !== 1) return k;
  return f(65) + f(66);
}
const run = unseen(read);
const one = new Kit();
let last: unknown;
for (let r = 0; r < 300; r++) last = run(one, r);
console.log(String(last), String(run(unseen({ ns: { fromCharCode: () => "?" } } as any), 1)));
