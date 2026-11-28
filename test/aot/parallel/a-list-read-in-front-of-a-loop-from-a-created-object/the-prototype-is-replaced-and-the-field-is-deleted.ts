// A loop reads a list of rows in front of its turns, out of a field of a created object. The object gets another prototype, the field is deleted so that the list comes from there, or a list is stored above it.
const outside: any = globalThis;
const numberOf = (value: number): number => Number(outside.missing ?? value);
const other: any = { label() { return "other"; }, bins: [[31, 32], [33, 34, 35]] };
function fill(turns: number, way: number) {
  const base: any = { label() { return "base"; } };
  const shelf = Object.create(base);
  shelf.bins = [[1, 2, 3], [4, 5, 6]];
  if (way == 1) Object.setPrototypeOf(shelf, other);
  if (way == 2) { delete shelf.bins; Object.setPrototypeOf(shelf, other); }
  if (way == 3) base.bins = [[41], [42]];
  let total = 0;
  for (let i = 0; i < turns; i++) {
    const first = shelf.bins[0], second = shelf.bins[1];
    first[i] = i + 1;
    total += second[i % second.length];
  }
  return total + " " + JSON.stringify(shelf.bins) + " " + JSON.stringify(base.bins) + " " + Object.keys(shelf);
}
const functions = [fill];
for (const way of [0, 1, 2, 3]) for (const turns of [numberOf(20), numberOf(5)]) {
  try { console.log(way, functions[numberOf(0)](turns, numberOf(way))); } catch (error) { console.log(way, (error as Error).name); }
}
