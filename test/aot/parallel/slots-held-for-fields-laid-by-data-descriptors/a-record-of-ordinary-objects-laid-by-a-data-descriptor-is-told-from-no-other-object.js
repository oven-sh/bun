// The constructor lays `bins` by a data descriptor, writable and hidden. The record that it is seen to lay lists no name and is filled under keys, so its objects are ordinary objects: the run time can tell them from no other object. The slot is held to no such record, only to objects: what is read out of it is asked each time. Code out of a text stores a list.
// STATISTIC: FieldTypesEnforced >= 1
// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
const poke = (0, eval)("(holder, value) => { holder.bins = value; }");
class Shelf {
  constructor(names) {
    const bins = {};
    for (let i = 0; i < names.length; i++) bins[names[i]] = i;
    Object.defineProperty(this, "bins", { value: bins, writable: true, enumerable: false });
    this.count = 2;
  }
}
function tell(shelf) {
  let lists = 0, total = 0;
  for (let i = 0; i < 9; i++) {
    const bins = shelf.bins;
    total = (total + shelf.count) | 0;
    if (Array.isArray(bins)) lists++;
  }
  return lists + ":" + total;
}
const names = JSON.parse('["a","b"]');
const when = Number(process.argv[2] ?? 299);
let last = "";
for (let turn = 0; turn < 300; turn++) {
  const shelf = new Shelf(names);
  if (turn === when) poke(shelf, [1, 2, 3]);
  last = tell(shelf);
}
console.log(last);
