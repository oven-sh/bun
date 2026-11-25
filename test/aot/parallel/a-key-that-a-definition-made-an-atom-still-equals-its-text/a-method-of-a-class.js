// Under: --obfuscate: an obfuscated executable names no function after its key, so the definition alone makes the key an atom
const unseen = (x) => [x][JSON.parse("0")];
function probe(head, tails) {
  let hits = 0;
  for (let i = 0; i < 4; i++) {
    const key = head + tails[i & 1];
    const long = key.length;
    class Crate { [key]() { return 7; } }
    if (key === "alphabet") hits += 1;
    hits += long * 10 + new Crate().alphabet() * 100;
  }
  return hits;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += probe(String(unseen("alpha")), [String(unseen("bet")), String(unseen("bet"))]);
console.log(sum);
