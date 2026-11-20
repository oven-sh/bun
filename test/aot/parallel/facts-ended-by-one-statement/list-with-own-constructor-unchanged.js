// A list in a constant stays as it was made.
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
}
