// A literal made anew for each call: between the setter and the getter of one name stands a member that stores to the variable that the getter returns. The two halves are laid down together, as where nothing stands between them.
interface Cell { value: number; readonly stamp: number }
const seen: number[] = [];
function cellOf(start: number): Cell {
  let held = 0;
  return { set value(next: number) { seen[next & 7] = next; }, stamp: (held = start + 1), get value() { return held; } };
}
let sum = 0;
for (let i = 0; i < 100_000; i++) {
  const cell = cellOf(i & 15);
  cell.value = i;
  sum = (sum + cell.value + cell.stamp) | 0;
}
console.log(sum, seen.length, Object.keys(cellOf(1)).join());
