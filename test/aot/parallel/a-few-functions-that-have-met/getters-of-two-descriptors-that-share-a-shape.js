const hidden = value => { try { throw value; } catch (caught) { return caught; } };
function look(step) { return typeof step; }
const spare = () => "spare", other = () => "other";
const shelf = {};
Object.defineProperties(shelf, {
  width: { get() { return 3; }, set(value) { shelf.last = "width " + value; }, enumerable: true },
  depth: { get: () => 4, set: value => { shelf.last = "depth " + value; }, enumerable: true },
});
const found = hidden(shelf);
found.width = 5;
const first = found.last;
found.depth = 6;
console.log(found.width, found.depth, first, found.last, look(spare), look(other));
