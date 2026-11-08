const poke = (0, eval)("(holder, value) => { holder.bins = value; }");
class Shelf {
  constructor(names) {
    const bins = {};
    for (let i = 0; i < names.length; i++) bins[names[i]] = i;
    this.bins = bins;
    this.count = 2;
  }
}
function tell(shelf) {
  let hits = 0, total = 0;
  for (let i = 0; i < 9; i++) {
    const bins = shelf.bins;
    total = (total + shelf.count) | 0;
    if (typeof bins === "function") hits++;
  }
  return hits + ":" + total;
}
const names = JSON.parse('["a","b"]');
let last = "";
for (let turn = 0; turn < 300; turn++) {
  const shelf = new Shelf(names);
  if (turn === 299) poke(shelf, () => 1);
  last = tell(shelf);
}
console.log(last);
