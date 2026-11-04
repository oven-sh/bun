const unseen = (0, eval)("(x) => x");
class Kit { codec = JSON; }
const kits: Kit[] = [new Kit(), new Kit(), new Kit(), new Kit()];
kits.push(unseen({ codec: { stringify: () => "fake" } }));
function noise(): number { return unseen(0); }
function write(i: number, row: { a: number }): string {
  const kit = kits[i];
  const stringify = kit.codec.stringify;
  noise();
  return stringify(row) + stringify(row);
}
const run = unseen(write);
let total = 0;
for (let r = 0; r < 300; r++) total += run(r % 4, { a: r }).length;
console.log(total, run(4, { a: 1 }));
