// The record that the constructor stores has a computed name, so its objects are ordinary objects: the run time can tell them from no other object. A function of the program that stores its argument
// into the field is let go and called out of sight with a list. The slot is held to what the run time can ask, an object: what is read out of it in the loop is asked whether it is a list.
class Shelf {
  constructor(name) { this.bins = { [name]: 1 }; this.count = 2; }
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
const key = String(process.argv[2] ?? "k0");
const shelf = new Shelf(key);
const lay = bins => { shelf.bins = bins; };
lay(new Shelf(key).bins);
let last = "";
for (let turn = 0; turn < 299; turn++) last = tell(shelf);
queueMicrotask(lay.bind(null, [1, 2, 3]));
await null;
last = tell(shelf);
console.log("SAID", last);
