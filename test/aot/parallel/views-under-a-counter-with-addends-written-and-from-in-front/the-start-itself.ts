function lay(cells: Int32Array, start: number, end: number): number {
  let one = 1;
  const from = start | 0, to = end | 0;
  for (let i = from; i < to; i++) { cells[i + one] = 5; cells[i + 1] = 6; cells[i] = 7; }
  return to;
}
const room = new ArrayBuffer(32);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4);
for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; }
const given: number[] = JSON.parse("[-1, 3]");
console.log(lay(middle, given[0]!, given[1]!), front.join(), middle.join());
