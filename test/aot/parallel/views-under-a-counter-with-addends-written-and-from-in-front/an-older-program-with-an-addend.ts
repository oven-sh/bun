function lay(first: Int32Array, second: Int32Array, start: number, end: number, move: number): number {
  const from = start | 0, to = end | 0, shift = move | 0;
  if (from + shift >= 0) return -1;
  for (let i = from; i < to; i++) { first[i + shift] = 7; second[i + shift] = 7; }
  return to;
}
const room = new ArrayBuffer(48);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4), behind = new Int32Array(room, 32, 4), other = new Int32Array(4);
for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; behind[at] = 7000 + at; }
const given: number[] = JSON.parse("[0, 3, 0, -3, 2, 1]");
console.log(lay(other, middle, given[0]!, given[1]!, given[2]!), front.join(), middle.join(), behind.join(), other.join());
console.log(lay(other, middle, given[3]!, given[4]!, given[5]!), front.join(), middle.join(), behind.join(), other.join());
