const unseen = (0, eval)("(x) => x");
class Kit { text = String; }
const kits: Kit[] = [new Kit(), new Kit()];
kits.push(unseen({ text: { fromCharCode: () => "?" } }));
function noise(): number { return unseen(0); }
function read(i: number): string {
  const kit = kits[i];
  const from = kit.text.fromCharCode;
  noise();
  return from(65) + from(66);
}
const run = unseen(read);
let last = "";
for (let r = 0; r < 300; r++) last = run(r % 2);
console.log(last, run(2));
