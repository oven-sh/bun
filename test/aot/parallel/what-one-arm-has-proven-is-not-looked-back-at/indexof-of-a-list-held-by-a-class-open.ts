const unseen = (0, eval)("(x) => x");
class Kit { held = [3, 1, 2]; }
const kits: Kit[] = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ held: { indexOf: () => -7 } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.held.indexOf as any;
  noise();
  return f.call(kit.held, 1);
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
