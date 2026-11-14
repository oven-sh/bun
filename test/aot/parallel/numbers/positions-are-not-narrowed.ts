// Positions of 64 bits inside lists and views: counters that start at sums, below zero, and at the last elements, in loops that are unrolled.
const lines: string[] = [];
const words = new Uint16Array(37);
const integers = new Int32Array(37);
const list: number[] = [];
for (let i = 0; i < 37; i++) {
  words[i] = i * 1777;
  integers[i] = i * -977;
  list.push(i * 31);
}
function from(start: number[], x: number): string {
  let sum = 0,
    found = 0,
    text = "";
  for (let y = start[x]! - 3; y < words.length; y++) sum += words[y] ?? 1000;
  for (let y = start[x]! + 2; y < integers.length; y++) if (integers[y]! & (1 << x)) found++;
  for (let y = start[x]! - 1; y < 37; y++) text += list[y] + ",";
  return sum + " " + found + " " + text.length;
}
function beside(view: Int32Array, offset: number): number {
  let sum = 0;
  for (let i = 0; i + offset + 3 < view.length; i++) sum = (sum + view[i + offset]! * 3 - view[i + offset + 1]! + view[i + offset + 3]!) | 0;
  return sum;
}
function backwards(view: Uint16Array, start: number): number {
  let sum = 0;
  for (let i = start - 1; i >= 0; i--) sum = (sum * 3 + view[i]!) | 0;
  return sum;
}
const starts = [0, 1, 3, 17, 33, 36, 37, 40, -2];
for (let turn = 0; turn < 3; turn++) {
  for (let x = 0; x < starts.length; x++) lines.push(from(starts, x));
  for (const offset of [0, 1, 5, 30]) lines.push(String(beside(integers, offset)));
  for (const start of [0, 1, 36, 37]) lines.push(String(backwards(words, start)));
  words[turn] = 65535;
}
console.log(lines.join("\n"));
