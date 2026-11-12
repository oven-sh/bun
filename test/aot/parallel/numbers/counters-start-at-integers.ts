// A loop inside begins to count at a sum with an element: an integer, one below zero, one past the bound, a fraction, NaN, undefined past the end.
const lines: string[] = [];
const rows = new Uint16Array(20);
for (let i = 0; i < 20; i++) rows[i] = (i * 37) & 255;
function holes(list: number[], n: number): number {
  let count = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 20 - list[x]! + 1; y < 20; y++) if (!(rows[y]! & (1 << x))) count++;
  }
  return count;
}
function above(list: number[]): string {
  let count = 0,
    sum = 0;
  for (let x = 0; x < list.length; x++) {
    sum += list[x]!;
    for (let y = list[x]! - 2; y < rows.length; y++) count += rows[y] === undefined ? 1000 : rows[y]!;
    if (x) sum += Math.abs(list[x]! - list[x - 1]!);
  }
  return count + " " + sum;
}
function shown(list: number[], bound: number): string {
  let text = "";
  for (let x = 0; x < list.length; x++) {
    for (let y = list[x]! + 3, turns = 0; y < bound && turns < 3; y++, turns++) text += y + ",";
    text += ";";
  }
  return text;
}
const lists: number[][] = [
  [8, 7, 6, 8, 8, 5, 8, 8, 3, 8],
  [0, -3, 25, 21, 20, 1],
  [2.5, 7, -0.5],
  [NaN, 3, -0],
  [2147483647, -2147483648, 0],
  [4294967296, 9007199254740991],
];
for (let turn = 0; turn < 3; turn++) {
  lines.push(String(holes(lists[0]!, 10)), String(holes(lists[0]!, 12)), String(holes(lists[1]!, 6)), String(holes(lists[2]!, 3)), String(holes(lists[3]!, 3)));
  for (const list of lists.slice(0, 4)) lines.push(above(list));
  for (const list of lists) lines.push(shown(list, 20), shown(list, 2147483650), shown(list, 9007199254740992));
  lists[0]![3] = turn ? 0.5 : 30;
}
console.log(lines.join("\n"));
