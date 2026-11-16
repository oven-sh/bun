const box = { count: 1 };
const noisy = { [Symbol.iterator]() { box.count = box.count + 1; return [][Symbol.iterator](); } };
function makeMap(entries?: Iterable<[unknown, unknown]>) { return new Map(entries); }
function makeSet(values?: Iterable<unknown>) { return new Set(values); }
function run(entries: any) {
  const before = box.count;
  const map = makeMap(entries);
  const between = box.count;
  const set = makeSet(entries);
  return before + " " + between + " " + box.count + " " + map.size + " " + set.size;
}
for (let turn = 0; turn < 3; turn++) console.log(run(undefined), run(null), run(noisy));
