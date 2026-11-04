const unseen = (0, eval)("(x) => x");
class Kit { ns = Math; }
const kits = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ ns: { floor: () => -1 } }));
function noise() { return unseen(0); }
function read(i) {
  const kit = kits[i];
  const f = kit.ns.floor;
  
  return f(2.5) + f(3.5);
}
const run = unseen(read);
let last;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
