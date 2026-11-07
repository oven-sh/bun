function smooth(a: Float64Array, start: number, end: number): number {
  let one = 1;
  const from = start | 0, to = end | 0;
  for (let i = from; i < to; i++) { a[i + one] = 5; a[i + 1] = 6; a[i + -1] = 7; }
  return to;
}
const room = new ArrayBuffer(128);
const front = new Float64Array(room, 0, 4), middle = new Float64Array(room, 32, 4);
for (let at = 0; at < 4; at++) { front[at] = 1000 + at; middle[at] = at + 1; }
const given: number[] = JSON.parse("[0, 3]");
console.log(smooth(middle, given[0]!, given[1]!), front.join(), middle.join());
