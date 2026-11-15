function lay(first: Int32Array, second: Int32Array, start: number, end: number): number {
  const from = start | 0, to = end | 0;
  if (from >= 0) return -1;
  for (let i = from; i < to; i++) { first[i] = 7; second[i] = 7; }
  return to;
}
const room = new ArrayBuffer(48);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4), other = new Int32Array(4);
for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; }
const given: number[] = JSON.parse("[0, 3, -2, 2]");
console.log(lay(other, middle, given[0]!, given[1]!), front.join(), middle.join(), other.join());
console.log(lay(other, middle, given[2]!, given[3]!), front.join(), middle.join(), other.join());
