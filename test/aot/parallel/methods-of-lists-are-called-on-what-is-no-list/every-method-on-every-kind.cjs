const values = [5, 0.5, "text", true, undefined, null, 7n, Symbol("s"), { map: 1 }, () => 1];
const calls = {
  at: v => v.at(0),
  every: v => v.every(x => x),
  filter: v => v.filter(x => x),
  find: v => v.find(x => x),
  findIndex: v => v.findIndex(x => x),
  findLast: v => v.findLast(x => x),
  findLastIndex: v => v.findLastIndex(x => x),
  flatMap: v => v.flatMap(x => [x]),
  forEach: v => v.forEach(x => x),
  map: v => v.map(x => x),
  reduce: v => v.reduce((a, x) => a + x, 0),
  reduceRight: v => v.reduceRight((a, x) => a + x, 0),
  some: v => v.some(x => x),
};
const lists = [[1, 2], []];
for (const [name, call] of Object.entries(calls)) {
  for (const value of values) {
    try {
      console.log(name, typeof value, String(call(value)));
    } catch (error) {
      console.log(name, typeof value, error.constructor.name);
    }
  }
  console.log(name, lists.map(list => String(call(list))).join(" | "));
}
