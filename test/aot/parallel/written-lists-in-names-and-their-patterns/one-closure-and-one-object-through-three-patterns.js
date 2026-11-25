const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function same(tools, at) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const held = new Set();
  const box = { at };
  let [first, second, third, count] = [() => at, box, box, tools.round(at + 0.5)];
  held.add(first); held.add(second); held.add(third);
  [first, second] = [second, first];
  held.add(first); held.add(second);
  const [again, other] = [second, () => at];
  held.add(again); held.add(other);
  return [held.size, again === second, first === box, third === first, other === again, second(), count, work].join(":");
}
let out = "";
for (let round = 0; round < 300; round++) out = same(kit, round % 5);
console.log(out);
