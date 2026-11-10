const unseen = (0, eval)("(x) => x");
class Kit { constructor() { this.math = Math; } }
const kits = [new Kit(), new Kit(), new Kit(), new Kit()];
kits.push(unseen({ math: { floor: () => -1 } }));
function noise() { return unseen(0); }
function read(i) {
  const kit = kits[i];
  const floor = kit.math.floor;
  noise();
  return floor(2.5) + floor(3.5);
}
const run = unseen(read);
let total = 0;
for (let r = 0; r < 300; r++) total += run(r % 4);
console.log(total, run(4));
