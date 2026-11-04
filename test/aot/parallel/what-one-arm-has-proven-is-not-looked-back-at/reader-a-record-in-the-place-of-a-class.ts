const unseen = (0, eval)("(x) => x");
type Kit = { math: Math; id: number };
const kits: Kit[] = [{ math: Math, id: 1 }, { math: Math, id: 2 }];
kits.push(unseen({ id: 3, math: { floor: () => -1 } }));
function noise(): number { return unseen(0); }
function read(i: number): number {
  const kit = kits[i];
  const floor = kit.math.floor;
  noise();
  return floor(2.5) + floor(3.5);
}
const run = unseen(read);
let total = 0;
for (let r = 0; r < 300; r++) total += run(r % 2);
console.log(total, run(2));
