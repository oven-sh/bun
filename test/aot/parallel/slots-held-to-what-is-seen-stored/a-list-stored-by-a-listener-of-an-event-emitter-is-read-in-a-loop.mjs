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
const { EventEmitter } = await import("node:events");
new EventEmitter().on("filled", lay).emit("filled", [1, 2, 3]);
last = tell(shelf);
console.log("SAID", last);
