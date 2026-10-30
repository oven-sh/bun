// A list of small whole numbers is sorted into a new list.
function show(list: unknown[]): string {
  const parts: string[] = [];
  for (let index = 0; index < list.length; index++) parts.push(index in list ? (Object.is(list[index], -0) ? "-0" : String(list[index])) : "hole");
  return `${list.length}[${parts.join(",")}]`;
}
const lines: string[] = [];
const lists: number[][] = [
  [],
  [7],
  [2, 1],
  [3, 1, 2, 3, 1, 2],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9],
  [2147483647, -2147483648, 0, 1, -1],
  JSON.parse("[5,3,9,1,7,3,5,0,8,2,6,4,11,10,15,13,12,14,19,17,16,18,21,20]"),
  Array.from({ length: 40 }, (_, k) => (k * 17) % 23),
];
for (const list of lists) {
  const calls: string[] = [];
  const sorted = list.toSorted((a, b) => {
    calls.push(`${a}:${b}`);
    return a - b;
  });
  lines.push(show(list) + " > " + show(sorted) + " " + calls.join(" "));
  const backward = list.toSorted((a, b) => b - a);
  const byLastDigit = list.toSorted((a, b) => (Math.abs(a) % 10) - (Math.abs(b) % 10));
  lines.push(show(backward) + " " + show(byLastDigit) + " " + (sorted === list) + " " + Array.isArray(sorted));
  sorted.push(0.5);
  sorted[0] = "first" as unknown as number;
  lines.push(show(sorted) + " " + show(list));
}
const holed: number[] = [3, , 1, , 2] as number[];
lines.push(show(holed.toSorted((a, b) => a - b)) + " " + show(holed));
const changing = [4, 3, 2, 1];
lines.push(
  show(
    changing.toSorted((a, b) => {
      changing[0] = 9;
      changing.length = 2;
      return a - b;
    }),
  ) +
    " " +
    show(changing),
);
try {
  [3, 2, 1].toSorted(() => {
    throw new RangeError("from the comparator");
  });
} catch (error) {
  lines.push(String(error));
}
let total = 0;
for (let turn = 0; turn < 300; turn++) {
  const sorted = lists[4]!.toSorted((a, b) => a - b);
  for (let index = 0; index < sorted.length; index++) sorted[index] = sorted[index]! + turn;
  total += sorted[0]! + sorted[18]!;
}
lines.push("total " + total);
console.log(lines.join("\n"));
