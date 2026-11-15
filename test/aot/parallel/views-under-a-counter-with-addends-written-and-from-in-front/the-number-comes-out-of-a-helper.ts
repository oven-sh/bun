function reach(): number { return 2; }
function lay(cells: Int32Array, start: number, end: number): number {
  const ahead = reach(), from = start | 0, to = end | 0;
  for (let i = from; i < to; i++) { cells[i + ahead] = 5; cells[i + 2] = 6; cells[i + 1] = 7; }
  return to;
}
const room = new ArrayBuffer(48);
const front = new Int32Array(room, 0, 4), middle = new Int32Array(room, 16, 4), behind = new Int32Array(room, 32, 4);
for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; behind[at] = 7000 + at; }
const given: number[] = JSON.parse("[-2, 2]");
console.log(lay(middle, given[0]!, given[1]!), front.join(), middle.join(), behind.join());
