const unseen = (0, eval)("(x) => x");
class Kit { ns = Array; }
const kits = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ ns: { isArray: () => "fake" } }));
function noise() { return unseen(0); }
function read(i) {
  const kit = kits[i];
  const f = kit.ns.isArray;
  
  return f([]);
}
const run = unseen(read);
let last;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
