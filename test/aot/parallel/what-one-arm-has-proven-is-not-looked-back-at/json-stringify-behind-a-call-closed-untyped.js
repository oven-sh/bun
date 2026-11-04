const unseen = (x) => [x][JSON.parse("0")];
class Kit { ns = JSON; }
const kits = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({ ns: { stringify: () => "fake" } }));
function noise() { return unseen(0); }
function read(i) {
  const kit = kits[i];
  const f = kit.ns.stringify;
  noise();
  return f({ a: 1 });
}
const run = unseen(read);
let last;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
