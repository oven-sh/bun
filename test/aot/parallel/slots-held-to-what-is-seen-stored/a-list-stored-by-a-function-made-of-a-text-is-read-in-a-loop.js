// The slot of `bins` would be held to the record that the constructor is seen to store. That record lists no name and is filled under keys, so its objects are ordinary objects:
// the run time can tell them from no other object, and code out of a text stores something else. A slot is held to no such record: what is read out of it is asked each time.
const poke = new Function("holder", "value", "holder.bins = value;");
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
    if (Array.isArray(bins)) hits++;
  }
  return hits + ":" + total;
}
const names = JSON.parse('["a","b"]');
let last = "";
for (let turn = 0; turn < 300; turn++) {
  const shelf = new Shelf(names);
  if (turn === 299) poke(shelf, [1, 2, 3]);
  last = tell(shelf);
}
console.log(last);
