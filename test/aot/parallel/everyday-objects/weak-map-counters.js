// Counters kept outside their objects in a WeakMap
const counts = new WeakMap();
function touch(object) {
  counts.set(object, (counts.get(object) ?? 0) + 1);
  return counts.get(object);
}
function visits(order) {
  const places = [{ id: 0 }, { id: 1 }, { id: 2 }];
  const out = order.map(i => touch(places[i]));
  return out.join() + " " + places.map(place => counts.has(place)).join() + " " + counts.delete(places[0]) + counts.has(places[0]);
}
console.log(visits([0, 1, 0, 0]));
console.log(visits([2, 2]));
console.log(visits([]));
