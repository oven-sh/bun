// A list in a constant gets a constructor of its own and holes between two rounds.
class Own extends Array {
  get mark() {
    return "own";
  }
}
const items = [1, 2, 3, 4];
function show(list) {
  const [head, ...rest] = list;
  return head + "|" + rest.map(value => value + 1) + "|" + list.length + "|" + list.slice(1).join() + list.slice(1).mark;
}
for (let round = 0; round < 5; round++) {
  console.log(show(items), items.indexOf(undefined), items.includes(undefined));
  if (round === 2) {
    items.constructor = Own;
    items.length += 2;
  }
}
