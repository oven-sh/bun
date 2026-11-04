const unseen = (0, eval)("(x) => x");
class Kit { math = Math; }
const kits: Kit[] = [new Kit(), new Kit(), new Kit(), new Kit()];
kits.push(unseen({ math: { floor: () => -1 } }));
function noise(): number { return unseen(0); }
function read(i: number): number {
  const kit = kits[i];
  const floor = kit.math.floor;
  noise();
  return floor(2.5);
}
const run = unseen(read);
let total = 0;
for (let r = 0; r < 300; r++) total += run(r % 4);
console.log(total, run(4));
