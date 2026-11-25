function largest(list: number[]): number {
  return Math.max(...list);
}
function smallest(list: number[]): number {
  return Math.min(...list);
}
function show(value: number) {
  return Object.is(value, -0) ? "-0" : String(value);
}
const lists: number[][] = [
  [],
  [3],
  [1, 2, 3],
  [3, 2, 1],
  [-0, 0],
  [0, -0],
  [1.5, -2.25, 1e300],
  [1, NaN, 3],
  [NaN],
  [Infinity, -Infinity],
  [2147483647, -2147483648, 2147483648],
  Array.from({ length: 1000 }, (_, at) => (at * 7919) % 1009),
  Array.from({ length: 1000 }, (_, at) => ((at * 7919) % 1009) / 4),
];
for (const list of lists) console.log(list.length, show(largest(list)), show(smallest(list)));
const withHole = [1, , 3] as number[];
console.log(show(largest(withHole)), show(smallest(withHole)));
