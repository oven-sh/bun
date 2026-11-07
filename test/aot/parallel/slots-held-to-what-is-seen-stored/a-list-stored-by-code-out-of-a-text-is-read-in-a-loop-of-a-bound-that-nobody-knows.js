const poke = (0, eval)("(holder, value) => { holder.bins = value; }");
class Shelf {
  constructor(names) {
    const bins = {};
    for (let i = 0; i < names.length; i++) bins[names[i]] = i;
    this.bins = bins;
    this.count = 2;
  }
}
const bound = Number("3");
function tell(shelf) {
  let lists = 0, total = 0;
  for (let i = 0; i < bound; i++) {
    const bins = shelf.bins;
    total = (total + shelf.count) | 0;
    if (Array.isArray(bins)) lists++;
  }
  return lists + ":" + total;
}
const names = JSON.parse('["a","b"]');
let last = "";
for (let turn = 0; turn < 300; turn++) {
  const shelf = new Shelf(names);
  if (turn === 299) poke(shelf, [1, 2, 3]);
  last = tell(shelf);
}
console.log(last);
