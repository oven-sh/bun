const unseen = (0, eval)("(x) => x");
class Kit { math = Math; }
function noise(): number { return unseen(0); }
function read(kit: Kit): number {
  const max = kit.math.max;
  noise();
  return max(1, 2) + max(3, 4);
}
const run = unseen(read);
let total = 0;
for (let r = 0; r < 300; r++) total += run(new Kit());
console.log(total, run(unseen({ math: { max: () => -1 } })));
