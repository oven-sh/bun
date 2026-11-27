// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
const [OUT, INTO] = JSON.parse('["out","into"]');
const doors = { out(list, at) { list.splice(at, 1); }, into(list, at, item) { list.splice(at, 0, item); } };
const go = (door, ...rest) => doors[door](...rest);
const wholes = () => [1, 2, 3, 4];
const texts = () => ["a", "b", "c", "d"];
for (let turn = 0; turn < 4; turn++) {
  const first = wholes(), second = texts();
  go(OUT, first, 1);
  go(INTO, second, 1, "new");
  console.log("SAID", turn, JSON.stringify(first), JSON.stringify(second), JSON.stringify(wholes()), JSON.stringify(texts()));
}
