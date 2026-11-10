function makeShelf() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const table = new Map();
  const drop = (key) => { table.delete(key); };
  const registry = new FinalizationRegistry(drop);
  const put = (key, value) => { table.set(key, 1); registry.register(value, key); return table.size; };
  return { put, drop, work };
}
const shelf = makeShelf();
const kept = [{}, {}];
console.log(shelf.put("a", kept[0]), shelf.put("b", kept[1]), shelf.work);
shelf.drop("a");
console.log(shelf.put("c", kept[0]));
